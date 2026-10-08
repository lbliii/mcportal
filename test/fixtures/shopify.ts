import type { Fetcher } from '../../src/types.ts';
export const SHOP='https://shop.example.com';
export function product(id=1,amount='120.00',extra:Record<string,unknown>={}) {
  return {id:`gid://shopify/Product/${id}`,title:`Product ${id}`,handle:`product-${id}`,createdAt:'2026-10-01T12:00:00Z',featuredImage:null,
    variants:{nodes:[{id:`gid://shopify/ProductVariant/${id}`,title:'Default',availableForSale:true,price:{amount,currencyCode:'USD'},compareAtPrice:null}],pageInfo:{hasNextPage:false}},...extra};
}
export function catalogue(nodes:unknown[],more=false,cursor='next') { return {data:{shop:{name:'Example Store'},products:{nodes,pageInfo:{hasNextPage:more,endCursor:cursor}}}}; }
export function shopFetcher() {
  const state={nodes:[product()],failed:false,calls:0,robots:'User-agent: *\nAllow: /'};
  const fetcher:Fetcher=async(url,options)=>{
    if(!url.startsWith(SHOP))throw new Error('unexpected address');
    if(url.endsWith('/robots.txt'))return {url,status:200,text:state.robots,contentType:'text/plain',truncated:false};
    state.calls++;
    const query=JSON.parse(options?.body??'{}').query as string;
    const raw=query.includes('collection(handle:')?{data:{shop:{name:'Example Store'},collection:{title:'Clothing',products:catalogue(state.nodes).data.products}}}:catalogue(state.nodes);
    return {url,status:state.failed?503:200,text:JSON.stringify(raw),contentType:'application/json',truncated:false};
  };
  return {state,fetcher};
}
