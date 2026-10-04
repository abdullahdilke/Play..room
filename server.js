
const express=require("express");
const http=require("http");
const {WebSocketServer}=require("ws");
const crypto=require("crypto");
const app=express(), server=http.createServer(app);
app.use(express.static("public"));
const wss=new WebSocketServer({server,path:"/ws"});
const rooms=new Map();

const items=[
 {word:"Pizza",emoji:"🍕",cat:"Food"},{word:"Apple",emoji:"🍎",cat:"Food"},
 {word:"Burger",emoji:"🍔",cat:"Food"},{word:"Ice Cream",emoji:"🍦",cat:"Food"},
 {word:"Dog",emoji:"🐶",cat:"Animals"},{word:"Cat",emoji:"🐱",cat:"Animals"},
 {word:"Elephant",emoji:"🐘",cat:"Animals"},{word:"Penguin",emoji:"🐧",cat:"Animals"},
 {word:"Phone",emoji:"📱",cat:"Objects"},{word:"Chair",emoji:"🪑",cat:"Objects"},
 {word:"Table",emoji:"🪑",cat:"Objects"},{word:"Clock",emoji:"🕐",cat:"Objects"},
 {word:"Car",emoji:"🚗",cat:"Things"},{word:"Guitar",emoji:"🎸",cat:"Things"},
 {word:"Rocket",emoji:"🚀",cat:"Things"},{word:"Football",emoji:"⚽",cat:"Sports"}
];
const categories=["Food","Animals","Objects","Things","Sports"];

function send(ws,o){if(ws.readyState===1)ws.send(JSON.stringify(o))}
function broadcast(r,o){r.players.forEach(p=>send(p.ws,o))}
function pub(r){
 return {type:"state",room:r.code,host:r.host,players:r.players.map((p,i)=>({id:p.id,name:p.name,host:p.id===r.host})),
 game:r.game?.name||null,phase:r.game?.phase||"lobby"};
}
function state(r){broadcast(r,pub(r))}
function getPlayer(r,ws){return r.players.find(p=>p.ws===ws)}
function cleanName(s){return String(s||"").trim().slice(0,20)}

function startGame(r,name,opts={}){
 const players=r.players, n=players.length;
 if(n<2)return;
 const game={name,phase:"playing",turn:0,round:0,answers:{},votes:{},used:[],...opts};
 if(name==="Who Is The Imposter?"){
   const cat=opts.category||"Food"; const pool=items.filter(x=>x.cat===cat); const item=pool[Math.floor(Math.random()*pool.length)];
   game.secret=item; game.imposter=players[Math.floor(Math.random()*n)].id; game.phase="secret"; game.category=cat; game.turn=0;
 } else if(name==="20 Questions"){
   game.secret=items[Math.floor(Math.random()*items.length)]; game.phase="questions"; game.turn=0; game.questionCount=0; game.questions=[];
 } else if(name==="Silent Charades"){
   game.secret=items[Math.floor(Math.random()*items.length)]; game.actor=players[Math.floor(Math.random()*n)].id; game.phase="charade"; game.guesses={};
 } else if(name==="Category Clash"){
   game.category=opts.category||categories[Math.floor(Math.random()*categories.length)]; game.phase="answers"; game.answers={}; game.round=1;
 } else if(name==="Majority Rules"){
   const qs=["Pick a better weekend: beach or mountains?","Which is better: pizza or burgers?","Which would most people choose: cats or dogs?","Pick one: morning or night?","Which is more fun: movies or games?"];
   game.question=qs[Math.floor(Math.random()*qs.length)]; game.options=["Option A","Option B"]; game.phase="vote";
 } else if(name==="The Secret Clue"){
   game.secret=items[Math.floor(Math.random()*items.length)]; game.bluffer=players[Math.floor(Math.random()*n)].id; game.phase="clues"; game.clues={};
 } else if(name==="Word Chain"){
   const starts=["Apple","Game","Night","House","Water","Music"]; game.current=starts[Math.floor(Math.random()*starts.length)]; game.turn=0; game.phase="chain"; game.used=[game.current.toLowerCase()];
 }
 r.game=game; sendPrivate(r); state(r);
}
function sendPrivate(r){
 const g=r.game;if(!g)return;
 r.players.forEach((p,i)=>{
   let x={type:"private",game:g.name,phase:g.phase};
   if(g.name==="Who Is The Imposter?"){
     x.role=p.id===g.imposter?"imposter":"player"; x.category=g.category;
     if(p.id!==g.imposter)x.item=g.secret;
   } else if(g.name==="20 Questions"){
     x.turn=r.players[g.turn]?.name; x.secret=(p.id===g.host&&g.phase==="result")?g.secret:null;
   } else if(g.name==="Silent Charades"){
     x.actor=p.id===g.actor; if(p.id===g.actor)x.item=g.secret;
   } else if(g.name==="Category Clash") x.category=g.category;
   else if(g.name==="Majority Rules") {x.question=g.question;x.options=g.options}
   else if(g.name==="The Secret Clue"){x.item=p.id===g.bluffer?null:g.secret;x.isBluffer=p.id===g.bluffer}
   else if(g.name==="Word Chain") x.current=g.current;
   send(p.ws,x);
 });
}

wss.on("connection",ws=>{
 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="create"){
   const code=crypto.randomBytes(3).toString("hex").toUpperCase(), p={id:crypto.randomUUID(),name:cleanName(m.name),ws};
   const r={code,host:p.id,players:[p],game:null};rooms.set(code,r);ws.room=code;send(ws,{type:"joined",code});state(r);
  }
  if(m.type==="join"){
   const r=rooms.get(String(m.code||"").toUpperCase()); if(!r)return send(ws,{type:"error",msg:"Room not found"});
   if(r.players.length>=12)return send(ws,{type:"error",msg:"Room is full"});
   const p={id:crypto.randomUUID(),name:cleanName(m.name),ws};r.players.push(p);ws.room=r.code;send(ws,{type:"joined",code:r.code});state(r);
  }
  const r=rooms.get(ws.room); if(!r)return;
  if(m.type==="start"){if(getPlayer(r,ws)?.id!==r.host)return;startGame(r,m.game,m)}
  const p=getPlayer(r,ws),g=r.game;if(!p||!g)return;
  if(m.type==="nextSecret"&&g.name==="Who Is The Imposter?"){g.phase="questioning";g.turn=0;g.votes={};sendPrivate(r);state(r)}
  else if(m.type==="nextTurn"&&g.name==="Who Is The Imposter?"){g.turn=(g.turn+1)%r.players.length;sendPrivate(r);state(r)}
  else if(m.type==="vote"){g.votes[p.id]=m.target;if(Object.keys(g.votes).length===r.players.length){g.phase="result";g.voteTarget=Object.entries(g.votes).sort((a,b)=>Object.values(g.votes).filter(x=>x===b[1]).length-Object.values(g.votes).filter(x=>x===a[1]).length)[0]?.[1];sendPrivate(r);state(r)}}
  else if(m.type==="guessImposter"&&g.name==="Who Is The Imposter?"&&g.phase==="result"){g.guess=m.word;g.guessCorrect=String(m.word).toLowerCase()===String(g.secret.word).toLowerCase();state(r)}
  else if(m.type==="question"&&g.name==="20 Questions"&&g.phase==="questions"&&p.id===r.players[g.turn]?.id){g.questions.push({by:p.name,text:String(m.text).slice(0,120),answer:"Yes/No"});g.questionCount++;g.turn=(g.turn+1)%r.players.length;if(g.questionCount>=20)g.phase="result";sendPrivate(r);state(r)}
  else if(m.type==="charadeGuess"&&g.name==="Silent Charades"){g.guesses[p.id]=m.word;if(String(m.word).toLowerCase()===g.secret.word.toLowerCase())g.phase="result";sendPrivate(r);state(r)}
  else if(m.type==="answer"&&g.name==="Category Clash"){g.answers[p.id]=String(m.text).slice(0,40);if(Object.keys(g.answers).length===r.players.length)g.phase="result";state(r)}
  else if(m.type==="majorityVote"&&g.name==="Majority Rules"){g.answers[p.id]=m.choice;if(Object.keys(g.answers).length===r.players.length){g.counts={};Object.values(g.answers).forEach(v=>g.counts[v]=(g.counts[v]||0)+1);g.phase="result"}state(r)}
  else if(m.type==="clue"&&g.name==="The Secret Clue"){g.clues[p.id]=String(m.text).slice(0,50);if(Object.keys(g.clues).length===r.players.length)g.phase="result";state(r)}
  else if(m.type==="chain"&&g.name==="Word Chain"&&p.id===r.players[g.turn]?.id){const w=cleanName(m.word);if(!w)return;if(g.used.includes(w.toLowerCase()))return send(p.ws,{type:"error",msg:"Word already used"});g.current=w;g.used.push(w.toLowerCase());g.turn=(g.turn+1)%r.players.length;sendPrivate(r);state(r)}
  else if(m.type==="restart"){if(p.id===r.host){r.game=null;state(r)}}
 });
 ws.on("close",()=>{const r=rooms.get(ws.room);if(!r)return;r.players=r.players.filter(p=>p.ws!==ws);if(!r.players.length)return rooms.delete(r.code);if(r.host===getPlayer(r,ws)?.id)r.host=r.players[0].id;state(r)})
});
server.listen(process.env.PORT||10000,"0.0.0.0",()=>console.log("PlayRoom running"));
