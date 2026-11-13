export async function boundedBody(request: Request, limit: number) {
  const reader=request.body?.getReader(); if(!reader)return '';
  let size=0;const chunks:Uint8Array[]=[];
  try { for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Request too large.');chunks.push(value);} }
  finally {await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}
