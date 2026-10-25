const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

// Simple .env loader: no dotenv package required.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const app = express();
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'campus-connect-final-review-2026';
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB || 'campus_connect';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db = null;
let memory = { users: [], events: [], clubs: [], posts: [], teams: [], notifications: [] };

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const safeUser = u => ({
  id: String(u._id), _id: String(u._id), name: u.name, email: u.email,
  department: u.department || '', year: u.year || '', role: u.role || 'student',
  skills: u.skills || [], interests: u.interests || []
});
const keyId = x => String(x);
function mongoId(v) {
  if (typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v)) {
    try { const { ObjectId } = require('mongodb'); return new ObjectId(v); } catch (_) {}
  }
  return v;
}

const hash = bcrypt.hashSync('password123', 10);
function seedMemory() {
  if (memory.users.length) return;
  memory.users = [
    { _id:'student1', name:'Priya Sharma', email:'student@srmist.edu.in', password:hash, department:'CSE', year:'2nd Year', role:'student', skills:['Python','UI/UX'], interests:['Photography','Technology'], createdAt:now() },
    { _id:'student2', name:'Rahul Menon', email:'rahul@srmist.edu.in', password:hash, department:'ECE', year:'2nd Year', role:'student', skills:['C++','Arduino'], interests:['IoT','Robotics'], createdAt:now() },
    { _id:'student3', name:'Sneha R', email:'sneha@srmist.edu.in', password:hash, department:'CSE', year:'3rd Year', role:'student', skills:['Java','MongoDB'], interests:['Music','Web Development'], createdAt:now() },
    { _id:'admin1', name:'Campus Administrator', email:'admin@srmist.edu.in', password:hash, department:'Administration', year:'Staff', role:'super_admin', skills:[], interests:[], createdAt:now() }
  ];
  memory.clubs = [
    {_id:'club1',name:'Coding Club',category:'Technical',icon:'💻',description:'Programming, hackathons and developer communities.',members:[]},
    {_id:'club2',name:'Photography Club',category:'Creative',icon:'📸',description:'Campus photography and creative projects.',members:[]},
    {_id:'club3',name:'Music Club',category:'Cultural',icon:'🎵',description:'Singers, musicians and producers.',members:[]},
    {_id:'club4',name:'E-Cell SRM',category:'Entrepreneurship',icon:'🚀',description:'Startups, pitching and innovation.',members:[]}
  ];
  memory.events = [
    {_id:'event1',title:'HackSRM 2026',category:'Technical',date:'25 Sep 2026',time:'10:00 AM',place:'Tech Park',description:'Campus hackathon.',registeredUsers:[],status:'approved',createdBy:'admin1'},
    {_id:'event2',title:'Cultural Night',category:'Cultural',date:'27 Sep 2026',time:'6:00 PM',place:'Dr. T. P. Ganesan Auditorium',description:'Music, dance and performances.',registeredUsers:[],status:'approved',createdBy:'admin1'}
  ];
  memory.posts = [
    {_id:'post1',author:'student2',tag:'Campus Life',text:'Anyone interested in forming a team for the upcoming HackSRM 2026? Looking for people interested in development and UI/UX.',likes:[],createdAt:now()},
    {_id:'post2',author:'student3',tag:'Projects',text:'Our IoT project group is looking for one more member who knows ESP32 or Arduino.',likes:[],createdAt:now()}
  ];
  memory.teams = [
    {_id:'team1',type:'Hackathon',title:'Smart Campus Team',owner:'student2',description:'Looking for developers and a UI/UX designer.',skillsNeeded:['React','Node.js','UI/UX'],requests:[]},
    {_id:'team2',type:'Academic',title:'AI & Data Analytics Project',owner:'student3',description:'Academic project involving Python and data analysis.',skillsNeeded:['Python','Pandas','Power BI'],requests:[]}
  ];
  memory.notifications = [];
}

async function connectMongo() {
  if (!MONGODB_URI) { seedMemory(); console.log('MongoDB URI not configured — using local demo mode.'); return; }
  try {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 7000 });
    await client.connect();
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB Atlas.');
    const users = db.collection('users');
    const count = await users.countDocuments();
    if (!count) {
      seedMemory();
      await users.insertMany(memory.users.map(x=>({...x})));
      await db.collection('clubs').insertMany(memory.clubs.map(x=>({...x})));
      await db.collection('events').insertMany(memory.events.map(x=>({...x})));
      await db.collection('posts').insertMany(memory.posts.map(x=>({...x})));
      await db.collection('teams').insertMany(memory.teams.map(x=>({...x})));
    }
    // Always ensure a working demo admin exists.
    const admin = await users.findOne({ email:'admin@srmist.edu.in' });
    if (!admin) await users.insertOne({...memory.users.find(x=>x.role==='super_admin')});
  } catch (err) {
    db = null; seedMemory();
    console.log('MongoDB connection failed — using local demo mode instead.');
    console.log('Atlas message:', err.message);
  }
}

function coll(name) { return db ? db.collection(name) : null; }
async function all(name) { return db ? coll(name).find({}).toArray() : memory[name]; }
async function one(name, filter) { return db ? coll(name).findOne(filter) : memory[name].find(x => Object.entries(filter).every(([k,v]) => String(x[k])===String(v))); }
async function insert(name, doc) { if (db) { await coll(name).insertOne(doc); return doc; } memory[name].push(doc); return doc; }
async function update(name, filter, patch) {
  if (db) { await coll(name).updateOne(filter, {$set:patch}); return coll(name).findOne(filter); }
  const item = memory[name].find(x => Object.entries(filter).every(([k,v]) => String(x[k])===String(v)));
  if (item) Object.assign(item, patch); return item;
}
async function remove(name, filter) { if (db) return coll(name).deleteOne(filter); const i=memory[name].findIndex(x=>Object.entries(filter).every(([k,v])=>String(x[k])===String(v))); if(i>=0) memory[name].splice(i,1); }

function auth(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({message:'Session expired. Please log in again.'});
  try { req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); } catch(e){ return res.status(401).json({message:'Session expired. Please log in again.'}); }
}
function role(...roles){ return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({message:'You do not have permission for this action.'}); }
function tokenFor(u){ return jwt.sign({id:String(u._id),role:u.role,email:u.email},JWT_SECRET,{expiresIn:'7d'}); }
async function userById(uid){ return one('users',{_id:uid}); }
async function notify(userId,type,title,message,eventId=null){ return insert('notifications',{_id:id(),userId:String(userId),type,title,message,eventId,read:false,createdAt:now()}); }
async function notifyStudents(type,title,message,eventId=null){ const us=await all('users'); for(const u of us.filter(x=>x.role==='student')) await notify(u._id,type,title,message,eventId); }

app.post('/api/auth/register', async (req,res)=>{
  try {
    const {name,email,password,department,year,skills=[],interests=[]}=req.body||{};
    if(!name||!email||!password) return res.status(400).json({message:'Name, SRM email and password are required.'});
    if(!String(email).toLowerCase().endsWith('@srmist.edu.in')) return res.status(400).json({message:'Use your SRM email address.'});
    const existing=await one('users',{email:String(email).toLowerCase()});
    if(existing) return res.status(409).json({message:'An account with this email already exists.'});
    const u={_id:id(),name:String(name).trim(),email:String(email).toLowerCase(),password:await bcrypt.hash(password,10),department,year,role:'student',skills,interests,createdAt:now()};
    await insert('users',u); res.json({token:tokenFor(u),user:safeUser(u)});
  } catch(e){res.status(500).json({message:e.message})}
});

app.post('/api/auth/login', async (req,res)=>{
  try {
    const {email,password,loginType='student'}=req.body||{};
    const u=await one('users',{email:String(email||'').toLowerCase()});
    if(!u || !(await bcrypt.compare(String(password||''),u.password))) return res.status(401).json({message:'Invalid email or password.'});
    const isAdmin=u.role==='super_admin'||u.role==='club_admin';
    if(loginType==='admin' && !isAdmin) return res.status(403).json({message:'This account is not an admin account.'});
    if(loginType==='student' && isAdmin) return res.status(403).json({message:'Use Admin Login for this account.'});
    res.json({token:tokenFor(u),user:safeUser(u)});
  } catch(e){res.status(500).json({message:e.message})}
});

app.get('/api/me',auth,async(req,res)=>{const u=await userById(req.user.id); if(!u)return res.status(401).json({message:'Session expired. Please log in again.'}); res.json(safeUser(u));});
app.put('/api/me',auth,async(req,res)=>{const allowed=['name','department','year','skills','interests'];const patch={};for(const k of allowed)if(req.body[k]!==undefined)patch[k]=req.body[k];const u=await update('users',{_id:mongoId(req.user.id)},patch);res.json(safeUser(u));});

app.get('/api/events',auth,async(req,res)=>{
  const es=await all('events');
  const approved=es.filter(e=>e.status==='approved');
  const result=[];
  for(const e of approved){result.push({...e,_id:String(e._id),createdBy:undefined});}
  res.json(result);
});
app.post('/api/events',auth,role('student'),async(req,res)=>{
  const {title,category,date,time,place,description}=req.body||{};
  if(!title||!date||!time||!place||!description)return res.status(400).json({message:'Please complete all event fields.'});
  if(category==='Workshop')return res.status(400).json({message:'Workshops are created by administrators only.'});
  const e={_id:id(),title,category:category||'Technical',date,time,place,description,registeredUsers:[],status:'pending',createdBy:req.user.id,createdAt:now()};
  await insert('events',e);
  const admins=(await all('users')).filter(u=>u.role==='super_admin');
  for(const a of admins)await notify(a._id,'event_pending','New event awaiting approval',`${title} was submitted by a student.`,e._id);
  res.json(e);
});
app.post('/api/events/:id/register',auth,role('student'),async(req,res)=>{
  const e=await one('events',{_id:mongoId(req.params.id)});if(!e||e.status!=='approved')return res.status(404).json({message:'Event not found.'});
  const arr=e.registeredUsers||[];if(arr.map(String).includes(String(req.user.id)))return res.json(e);
  arr.push(req.user.id);const updated=await update('events',{_id:mongoId(req.params.id)},{registeredUsers:arr});res.json(updated);
});

app.get('/api/my-event-submissions',auth,role('student'),async(req,res)=>{const es=(await all('events')).filter(e=>String(e.createdBy)===String(req.user.id));res.json(es);});

app.get('/api/clubs',auth,async(req,res)=>{

  const clubs = (await all('clubs')).filter(
    c => c.status === 'approved' || c.status === undefined
  );

  res.json(
    clubs.map(x => ({
      ...x,
      _id: String(x._id)
    }))
  );

});
app.post('/api/clubs/:id/join',auth,role('student'),async(req,res)=>{const c=await one('clubs',{_id:mongoId(req.params.id)});if(!c)return res.status(404).json({message:'Club not found.'});const members=c.members||[];if(!members.map(String).includes(String(req.user.id)))members.push(req.user.id);res.json(await update('clubs',{_id:mongoId(req.params.id)},{members}));});
app.post('/api/clubs',auth,role('student'),async(req,res)=>{

  const {
    name,
    category,
    icon,
    description
  } = req.body || {};

  if(!name || !description){

    return res.status(400).json({
      message:'Please complete all club fields.'
    });

  }

  const c = {
    _id: id(),
    name,
    category: category || 'Technical',
    icon: icon || '🏛️',
    description,
    members: [],

    // IMPORTANT:
    // Student-created clubs must wait for admin approval.
    status: 'pending',

    createdBy: req.user.id,
    createdAt: now()
  };

  await insert('clubs', c);

  // Notify every Super Admin
  const admins = (await all('users'))
    .filter(u => u.role === 'super_admin');

  for(const admin of admins){

    await notify(
      admin._id,
      'club_pending',
      'New club awaiting approval',
      `${name} was submitted by a student.`,
      c._id
    );

  }

  res.json({

    message: 'Club submitted for admin approval.',

    club: c

  });

});

async function postView(p){const a=await userById(p.author);return {...p,author:a?safeUser(a):{name:'Student'}}}
app.get('/api/posts',auth,async(req,res)=>res.json(await Promise.all((await all('posts')).map(postView))));
app.post('/api/posts',auth,role('student'),async(req,res)=>{const p={_id:id(),author:req.user.id,tag:req.body.tag||'General',text:req.body.text||'',likes:[],createdAt:now()};await insert('posts',p);res.json(await postView(p));});
app.post('/api/posts/:id/like',auth,role('student'),async(req,res)=>{const p=await one('posts',{_id:mongoId(req.params.id)});if(!p)return res.status(404).json({message:'Post not found.'});const likes=p.likes||[];if(!likes.map(String).includes(String(req.user.id)))likes.push(req.user.id);res.json(await update('posts',{_id:mongoId(req.params.id)},{likes}));});

app.get('/api/students',auth,async(req,res)=>{const q=String(req.query.q||'').toLowerCase();const us=(await all('users')).filter(u=>u.role==='student' && String(u._id)!==String(req.user.id));res.json(us.filter(u=>!q||(`${u.name} ${u.department} ${u.year} ${(u.skills||[]).join(' ')} ${(u.interests||[]).join(' ')}`).toLowerCase().includes(q)).map(safeUser));});
app.post('/api/students/:id/connect',auth,role('student'),async(req,res)=>{const u=await userById(req.params.id);if(!u)return res.status(404).json({message:'Student not found.'});await notify(u._id,'connection','New connection request',`${(await userById(req.user.id))?.name||'A student'} wants to connect with you.`);res.json({message:'Connection request sent'});});

app.get('/api/teams',auth,async(req,res)=>{const type=req.query.type;const ts=(await all('teams')).filter(t=>!type||t.type===type);const out=[];for(const t of ts){const o=await userById(t.owner);out.push({...t,_id:String(t._id),owner:o?safeUser(o):{name:'Student'}})}res.json(out);});
app.post('/api/teams',auth,role('student'),async(req,res)=>{const t={_id:id(),type:req.body.type||'Academic',title:req.body.title,owner:req.user.id,description:req.body.description,skillsNeeded:req.body.skillsNeeded||[],requests:[]};await insert('teams',t);res.json(t);});
app.post('/api/teams/:id/request',auth,role('student'),async(req,res)=>{const t=await one('teams',{_id:mongoId(req.params.id)});if(!t)return res.status(404).json({message:'Team not found.'});const r=t.requests||[];if(!r.map(String).includes(String(req.user.id)))r.push(req.user.id);await update('teams',{_id:mongoId(req.params.id)},{requests:r});res.json({message:'Join request sent'});});

app.get('/api/notifications',auth,async(req,res)=>{const ns=(await all('notifications')).filter(n=>String(n.userId)===String(req.user.id)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));res.json(ns);});
app.patch('/api/notifications/:id/read',auth,async(req,res)=>{const n=await one('notifications',{_id:mongoId(req.params.id)});if(!n||String(n.userId)!==String(req.user.id))return res.status(404).json({message:'Notification not found.'});res.json(await update('notifications',{_id:mongoId(req.params.id)},{read:true}));});
app.patch('/api/notifications/read-all',auth,async(req,res)=>{const ns=(await all('notifications')).filter(n=>String(n.userId)===String(req.user.id));for(const n of ns)await update('notifications',{_id:mongoId(n._id)},{read:true});res.json({ok:true});});

app.get('/api/admin/stats',auth,role('super_admin'),async(req,res)=>{const [users,events,clubs]=await Promise.all([all('users'),all('events'),all('clubs')]);res.json({users:users.length,events:events.filter(e=>e.status==='approved').length,clubs:clubs.length,pendingEvents:events.filter(e=>e.status==='pending'&&e.category!=='Workshop').length,pendingClubs:clubs.filter(c=>c.status==='pending').length,workshops:events.filter(e=>e.category==='Workshop'&&e.status==='approved').length});});
app.get('/api/admin/events/pending',auth,role('super_admin'),async(req,res)=>{const es=(await all('events')).filter(e=>e.status==='pending');const out=[];for(const e of es){const u=await userById(e.createdBy);out.push({...e,_id:String(e._id),createdBy:u?safeUser(u):{name:'Student'}})}res.json(out);});
app.patch('/api/admin/events/:id',auth,role('super_admin'),async(req,res)=>{const status=['approved','rejected'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({message:'Invalid status.'});const e=await one('events',{_id:mongoId(req.params.id)});if(!e)return res.status(404).json({message:'Event not found.'});const updated=await update('events',{_id:mongoId(req.params.id)},{status});if(e.createdBy){await notify(e.createdBy,status==='approved'?'event_approved':'event_rejected',status==='approved'?'Event approved':'Event rejected',`${e.title} was ${status}.`,e._id);}res.json(updated);});
// ===============================
// ADMIN CLUB APPROVAL
// ===============================

app.get(
  '/api/admin/clubs/pending',
  auth,
  role('super_admin'),
  async(req,res)=>{

    const clubs = (await all('clubs'))
      .filter(c => c.status === 'pending');

    const result = [];

    for(const club of clubs){

      const creator =
        await userById(club.createdBy);

      result.push({

        ...club,

        _id: String(club._id),

        createdBy: creator
          ? safeUser(creator)
          : { name: 'Student' }

      });

    }

    res.json(result);

  }
);


app.patch(
  '/api/admin/clubs/:id',
  auth,
  role('super_admin'),
  async(req,res)=>{

    const status =
      ['approved','rejected']
        .includes(req.body.status)
        ? req.body.status
        : null;

    if(!status){

      return res.status(400).json({
        message: 'Invalid status.'
      });

    }

    const club =
      await one(
        'clubs',
        {
          _id: mongoId(req.params.id)
        }
      );

    if(!club){

      return res.status(404).json({
        message: 'Club not found.'
      });

    }

    const updated =
      await update(
        'clubs',
        {
          _id: mongoId(req.params.id)
        },
        {
          status
        }
      );

    // Notify the student who created the club
    if(club.createdBy){

      await notify(

        club.createdBy,

        status === 'approved'
          ? 'club_approved'
          : 'club_rejected',

        status === 'approved'
          ? 'Club approved'
          : 'Club rejected',

        `${club.name} was ${status}.`,

        club._id

      );

    }

    res.json(updated);

  }
);
app.get('/api/workshops',auth,async(req,res)=>res.json((await all('events')).filter(e=>e.category==='Workshop'&&e.status==='approved')));

app.post('/api/admin/workshops',auth,role('super_admin'),async(req,res)=>{
  const {title,date,time,place,description}=req.body||{};
  if(!title||!date||!time||!place||!description)return res.status(400).json({message:'Please complete all workshop fields.'});
  const e={_id:id(),title,category:'Workshop',date,time,place,description,registeredUsers:[],status:'approved',createdBy:req.user.id,createdAt:now()};
  await insert('events',e);
  await notifyStudents('workshop','New workshop announced',`${title} — ${date} at ${time}.`,e._id);
  res.json(e);
});
app.get('/api/admin/workshops',auth,role('super_admin'),async(req,res)=>res.json((await all('events')).filter(e=>e.category==='Workshop'&&e.status==='approved')));

// Development seed is safe to call repeatedly; it only fills empty collections.
app.post('/api/dev/seed',auth,async(req,res)=>{seedMemory(); if(db){const counts=await Promise.all(['clubs','events','posts','teams'].map(n=>coll(n).countDocuments())); if(counts.every(x=>x===0)){await coll('clubs').insertMany(memory.clubs.map(x=>({...x})));await coll('events').insertMany(memory.events.map(x=>({...x})));await coll('posts').insertMany(memory.posts.map(x=>({...x})));await coll('teams').insertMany(memory.teams.map(x=>({...x})));}}res.json({ok:true});});

// SPA fallback — Express 5 compatible.
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

connectMongo().then(()=>app.listen(PORT,()=>console.log(`Campus Connect running on http://localhost:${PORT}`)));
