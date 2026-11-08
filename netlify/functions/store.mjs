const PRODUCT_IDS = ['p1'];
const FIXED_PRICE_AMOUNTS = {p1:2000};
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};

const reply = (statusCode, data) => ({
  statusCode,
  headers: JSON_HEADERS,
  body: JSON.stringify(data)
});

function stripeKey(){
  const key=process.env.STRIPE_SECRET_KEY;
  return key&&/^(sk|rk)_(test|live)_/.test(key)?key:null;
}

async function stripeRequest(path,{key,method='GET',body}){
  return fetch(`https://api.stripe.com/v1/${path}`,{
    method,
    headers:{
      authorization:`Bearer ${key}`,
      ...(body?{'content-type':'application/x-www-form-urlencoded'}:{})
    },
    body
  });
}

function configuredPriceIds(){
  return Object.fromEntries(PRODUCT_IDS.map(id=>[id,process.env[`STRIPE_PRICE_${id.toUpperCase()}`]]));
}

async function getStripePrice(key,id,priceId){
  const response=await stripeRequest(`prices/${encodeURIComponent(priceId)}`,{key});
  const price=await response.json();
  if(!response.ok||!price.active||price.currency!=='eur'||!Number.isInteger(price.unit_amount)){
    console.error('Unable to load configured Stripe price',id,response.status,price.error?.type);
    throw new Error('Configured store prices are unavailable.');
  }
  if(FIXED_PRICE_AMOUNTS[id]!==undefined&&price.unit_amount!==FIXED_PRICE_AMOUNTS[id]){
    throw new Error('The Tooshie Stripe price must be exactly EUR 20.00.');
  }
  return {amount:price.unit_amount,currency:price.currency};
}

async function getPrices(key){
  const ids=configuredPriceIds();
  const prices={};
  for(const id of PRODUCT_IDS){
    if(!ids[id])continue;
    if(!/^price_[A-Za-z0-9]+$/.test(ids[id])){
      throw new Error(`The configured Stripe price ID for ${id} is invalid.`);
    }
    prices[id]=await getStripePrice(key,id,ids[id]);
  }
  return {prices,checkoutConfigured:isShippingConfigured()};
}

function parseItems(body){
  if(!Array.isArray(body?.items)||body.items.length<1||body.items.length>PRODUCT_IDS.length){
    return null;
  }
  const items=[];
  const seen=new Set();
  for(const item of body.items){
    if(!PRODUCT_IDS.includes(item?.id)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99||seen.has(item.id)){
      return null;
    }
    seen.add(item.id);
    items.push({id:item.id,quantity:item.quantity});
  }
  return items;
}

function shippingCountries(){
  const countries=(process.env.STRIPE_SHIPPING_COUNTRIES||'')
    .split(',')
    .map(code=>code.trim().toUpperCase())
    .filter(Boolean);
  if(!countries.length||countries.some(code=>!/^[A-Z]{2}$/.test(code))){
    return null;
  }
  return [...new Set(countries)];
}

function isShippingConfigured(){
  try{
    const url=new URL(process.env.URL);
    return url.protocol==='https:'
      &&shippingCountries()!==null
      &&/^shr_[A-Za-z0-9]+$/.test(process.env.STRIPE_SHIPPING_RATE_ID||'');
  }catch{
    return false;
  }
}

async function verifySession(event,key){
  const sessionId=event.queryStringParameters?.session_id||'';
  if(!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)){
    return reply(400,{error:'Invalid checkout session.'});
  }
  const response=await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`,{key});
  const session=await response.json();
  if(!response.ok){
    console.error('Unable to verify Stripe checkout session',response.status,session.error?.type);
    return reply(502,{error:'Payment status could not be verified.'});
  }
  return reply(200,{paymentStatus:session.payment_status});
}

async function createSession(event,key){
  let body;
  try{
    const raw=event.isBase64Encoded
      ?Buffer.from(event.body||'','base64').toString('utf8')
      :event.body||'';
    body=JSON.parse(raw);
  }catch{
    return reply(400,{error:'Invalid checkout request.'});
  }
  const items=parseItems(body);
  if(!items){
    return reply(400,{error:'Your cart is invalid. Review the items and try again.'});
  }

  const priceIds=configuredPriceIds();
  if(items.some(item=>!/^price_[A-Za-z0-9]+$/.test(priceIds[item.id]||''))){
    return reply(503,{error:'Product prices are not configured yet.'});
  }
  await Promise.all(items.map(item=>getStripePrice(key,item.id,priceIds[item.id])));
  const countries=shippingCountries();
  const shippingRate=process.env.STRIPE_SHIPPING_RATE_ID;
  const siteUrl=process.env.URL;
  if(!countries||!/^shr_[A-Za-z0-9]+$/.test(shippingRate||'')||!siteUrl){
    return reply(503,{error:'Worldwide shipping and checkout are not configured yet.'});
  }
  let baseUrl;
  try{
    baseUrl=new URL(siteUrl);
  }catch{
    return reply(503,{error:'The store URL is not configured correctly.'});
  }
  if(baseUrl.protocol!=='https:'){
    return reply(503,{error:'Secure checkout requires an HTTPS store URL.'});
  }

  const params=new URLSearchParams();
  params.set('mode','payment');
  params.set('billing_address_collection','required');
  params.set('phone_number_collection[enabled]','true');
  params.set('shipping_address_collection[allowed_countries][0]',countries[0]);
  countries.slice(1).forEach((country,index)=>params.set(`shipping_address_collection[allowed_countries][${index+1}]`,country));
  params.set('shipping_options[0][shipping_rate]',shippingRate);
  params.set('success_url',`${baseUrl.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#shop`);
  params.set('cancel_url',`${baseUrl.origin}/?checkout=cancelled#shop`);
  items.forEach((item,index)=>{
    params.set(`line_items[${index}][price]`,priceIds[item.id]);
    params.set(`line_items[${index}][quantity]`,String(item.quantity));
  });

  const response=await stripeRequest('checkout/sessions',{key,method:'POST',body:params});
  const session=await response.json();
  if(!response.ok||!session.url){
    console.error('Unable to create Stripe checkout session',response.status,session.error?.type);
    return reply(502,{error:'Secure checkout could not be started. Please try again later.'});
  }
  return reply(200,{url:session.url});
}

export const handler=async event=>{
  if(event.httpMethod!=='GET'&&event.httpMethod!=='POST'){
    return reply(405,{error:'Method not allowed.'});
  }
  const key=stripeKey();
  if(!key){
    return reply(503,{error:'Payments are not configured yet.'});
  }
  try{
    if(event.httpMethod==='POST'){
      return await createSession(event,key);
    }
    if(event.queryStringParameters?.session_id){
      return await verifySession(event,key);
    }
    const result=await getPrices(key);
    return reply(200,result);
  }catch(error){
    console.error('Stripe store request failed',error);
    return reply(502,{error:'The store could not reach the payment service. Please try again.'});
  }
};
