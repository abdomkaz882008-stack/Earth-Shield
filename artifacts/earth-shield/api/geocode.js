export default async function handler(req,res){
 const {q}=req.query;
 if(!q) return res.status(400).json({error:"missing"});
 const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,{headers:{'User-Agent':'Earth-Shield/1.0'}});
 const data=await r.json();
 res.setHeader('Cache-Control','s-maxage=86400');
 return res.status(200).json(data);
}
