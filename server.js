require('dotenv').config();
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://covenantolorunshola_db_user:KVhU2RKpC0QoULgh@cluster0.nx1xb20.mongodb.net/plugme?retryWrites=true&w=majority&appName=Cluster0';
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://coodev-git.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// ── MONGOOSE MODELS ───────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true },
  password:    { type: String, required: true },
  role:        { type: String, enum: ['student', 'worker'], required: true },
  phone:       { type: String, default: '' },
  bio:         { type: String, default: '' },
  skills:      [{ type: String }],
  rating:      { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const JobSchema = new mongoose.Schema({
  student:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedWorker: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  title:          { type: String, required: true },
  description:    { type: String, required: true },
  category:       { type: String, required: true },
  budget:         { type: Number, required: true },
  location:       { type: String, default: 'On Campus', index: false },
  status:         { type: String, enum: ['open','in_progress','completed','cancelled'], default: 'open' },
  agreedPrice:    { type: Number, default: null },
  offerCount:     { type: Number, default: 0 },
}, { timestamps: true });
const Job = mongoose.model('Job', JobSchema);

const OfferSchema = new mongoose.Schema({
  job:     { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  worker:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  price:   { type: Number, required: true },
  message: { type: String, default: '' },
  eta:     { type: String, default: '' },
  status:  { type: String, enum: ['pending','accepted','rejected','withdrawn'], default: 'pending' },
  chatId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
}, { timestamps: true });
const Offer = mongoose.model('Offer', OfferSchema);

const ChatSchema = new mongoose.Schema({
  job:          { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  offer:        { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastMessage:  { type: String, default: '' },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });
const Chat = mongoose.model('Chat', ChatSchema);

const MessageSchema = new mongoose.Schema({
  chat:     { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  text:     { type: String, required: true },
  isSystem: { type: Boolean, default: false },
}, { timestamps: true });
const Message = mongoose.model('Message', MessageSchema);

const ReviewSchema = new mongoose.Schema({
  job:      { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating:   { type: Number, required: true, min: 1, max: 5 },
  comment:  { type: String, default: '' },
}, { timestamps: true });
const Review = mongoose.model('Review', ReviewSchema);

const NotificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, required: true },
  title:     { type: String, required: true },
  message:   { type: String, required: true },
  isRead:    { type: Boolean, default: false },
  data:      { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
const Notification = mongoose.model('Notification', NotificationSchema);

const ContactUnlockSchema = new mongoose.Schema({
  student:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  worker:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
ContactUnlockSchema.index({ student: 1, worker: 1 }, { unique: true });
const ContactUnlock = mongoose.model('ContactUnlock', ContactUnlockSchema);

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────────
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const workerOnly = (req, res, next) => {
  if (req.user.role !== 'worker') return res.status(403).json({ error: 'Workers only' });
  next();
};
const studentOnly = (req, res, next) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Students only' });
  next();
};

// helper: create + emit notification
const notify = async (recipientId, type, title, message, data = {}) => {
  const n = await Notification.create({ recipient: recipientId, type, title, message, data });
  io.to(`user_${recipientId}`).emit('notification', n);
};

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, phone, skills } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role, phone: phone || '', skills: skills || [] });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ token, user: { _id: user._id, name, email, role, phone: user.phone, skills: user.skills, isAvailable: user.isAvailable } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, skills: user.skills, rating: user.rating, isAvailable: user.isAvailable } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json(req.user);
});

app.post('/api/auth/logout', auth, (req, res) => {
  res.json({ message: 'Logged out' });
});

// ── USER ROUTES ────────────────────────────────────────────────────────────────
app.get('/api/users/workers', auth, async (req, res) => {
  try {
    const { skill, q } = req.query;
    let filter = { role: 'worker' };
    if (skill) filter.skills = skill;
    if (q) filter.name = { $regex: q, $options: 'i' };
    const workers = await User.find(filter).select('-password').sort({ rating: -1 });
    res.json(workers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/users/dashboard', auth, workerOnly, async (req, res) => {
  try {
    const [activeJobs, totalEarnings, pendingOffers, reviews] = await Promise.all([
      Job.countDocuments({ assignedWorker: req.user._id, status: 'in_progress' }),
      User.findById(req.user._id).then(u => u.totalEarned),
      Offer.countDocuments({ worker: req.user._id, status: 'pending' }),
      Review.find({ reviewee: req.user._id }).sort({ createdAt: -1 }).limit(5),
    ]);
    res.json({ activeJobs, totalEarnings, pendingOffers, reviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/users/notifications', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json(notifications);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/users/notifications/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
    res.json({ message: 'Marked all read' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/users/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/users/me/profile', auth, async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'bio', 'skills', 'isAvailable'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── JOB ROUTES ────────────────────────────────────────────────────────────────
app.get('/api/jobs', auth, async (req, res) => {
  try {
    const { category, q } = req.query;
    let filter = { status: 'open' };
    if (category) filter.category = category;
    if (q) filter.title = { $regex: q, $options: 'i' };
    const jobs = await Job.find(filter).populate('student', 'name rating').sort({ createdAt: -1 });
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/jobs/my/posted', auth, studentOnly, async (req, res) => {
  try {
    const jobs = await Job.find({ student: req.user._id }).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/jobs/:id', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate('student', 'name rating phone').populate('assignedWorker', 'name rating');
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/jobs', auth, studentOnly, async (req, res) => {
  try {
    const { title, description, category, budget, location } = req.body;
    if (!title || !description || !category || !budget) return res.status(400).json({ error: 'Missing fields' });
    const job = await Job.create({ student: req.user._id, title, description, category, budget, location: location || 'On Campus' });
    res.status(201).json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/jobs/:id/complete', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (String(job.student) !== String(req.user._id)) return res.status(403).json({ error: 'Not your job' });
    if (job.status !== 'in_progress') return res.status(400).json({ error: 'Job not in progress' });
    job.status = 'completed';
    await job.save();
    // update worker earnings
    if (job.assignedWorker) {
      await User.findByIdAndUpdate(job.assignedWorker, { $inc: { totalEarned: job.agreedPrice || job.budget } });
      await notify(job.assignedWorker, 'job_completed', 'Job Completed!', `Your job "${job.title}" has been marked complete.`, { jobId: job._id });
    }
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/jobs/:id', auth, studentOnly, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (String(job.student) !== String(req.user._id)) return res.status(403).json({ error: 'Not your job' });
    job.status = 'cancelled';
    await job.save();
    res.json({ message: 'Cancelled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── OFFER ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/jobs/:jobId/offers', auth, workerOnly, async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'open') return res.status(400).json({ error: 'Job not open' });
    const existing = await Offer.findOne({ job: job._id, worker: req.user._id, status: 'pending' });
    if (existing) return res.status(409).json({ error: 'You already made an offer' });
    const { price, message, eta } = req.body;
    const offer = await Offer.create({ job: job._id, worker: req.user._id, student: job.student, price, message: message || '', eta: eta || '' });
    await Job.findByIdAndUpdate(job._id, { $inc: { offerCount: 1 } });
    await notify(job.student, 'new_offer', 'New Offer!', `Someone offered ₦${price} for "${job.title}"`, { jobId: job._id, offerId: offer._id });
    res.status(201).json(offer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/jobs/:jobId/offers', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ job: req.params.jobId }).populate('worker', 'name rating skills bio').sort({ createdAt: -1 });
    res.json(offers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/jobs/:jobId/offers/:offerId/accept', auth, studentOnly, async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (String(job.student) !== String(req.user._id)) return res.status(403).json({ error: 'Not your job' });
    const offer = await Offer.findById(req.params.offerId);
    if (!offer || offer.status !== 'pending') return res.status(400).json({ error: 'Offer not available' });

    // 1. Accept this offer
    offer.status = 'accepted';

    // 2. Reject all other offers
    await Offer.updateMany({ job: job._id, _id: { $ne: offer._id }, status: 'pending' }, { status: 'rejected' });

    // 3. Update job
    job.status = 'in_progress';
    job.assignedWorker = offer.worker;
    job.agreedPrice = offer.price;
    await job.save();

    // 4. Create chat
    const chat = await Chat.create({ job: job._id, offer: offer._id, participants: [job.student, offer.worker] });

    // 5. System message
    await Message.create({ chat: chat._id, isSystem: true, text: `Job started! Agreed price: ₦${offer.price}. Chat is now active.` });

    // 6. Link chat to offer
    offer.chatId = chat._id;
    await offer.save();

    // 7. Notify worker
    await notify(offer.worker, 'offer_accepted', 'Offer Accepted! 🎉', `Your offer for "${job.title}" was accepted at ₦${offer.price}`, { jobId: job._id, chatId: chat._id });

    // 8. Emit socket event
    io.to(`user_${offer.worker}`).emit('offer_accepted', { job, offer, chatId: chat._id });

    res.json({ job, offer, chatId: chat._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/jobs/:jobId/offers/:offerId/reject', auth, studentOnly, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.offerId);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    offer.status = 'rejected';
    await offer.save();
    await notify(offer.worker, 'offer_rejected', 'Offer Rejected', `Your offer was not selected this time.`, { jobId: req.params.jobId });
    res.json(offer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/offers/my', auth, workerOnly, async (req, res) => {
  try {
    const offers = await Offer.find({ worker: req.user._id }).populate('job', 'title category budget status').sort({ createdAt: -1 });
    res.json(offers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/offers/:offerId/withdraw', auth, workerOnly, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.offerId);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (String(offer.worker) !== String(req.user._id)) return res.status(403).json({ error: 'Not your offer' });
    offer.status = 'withdrawn';
    await offer.save();
    res.json({ message: 'Withdrawn' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CHAT ROUTES ───────────────────────────────────────────────────────────────
app.get('/api/chats', auth, async (req, res) => {
  try {
    const chats = await Chat.find({ participants: req.user._id, isActive: true })
      .populate('job', 'title status')
      .populate('participants', 'name role')
      .sort({ updatedAt: -1 });
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chats/:chatId', auth, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId).populate('job').populate('participants', 'name role');
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const messages = await Message.find({ chat: chat._id }).populate('sender', 'name').sort({ createdAt: 1 });
    res.json({ chat, messages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chats/:chatId/send', auth, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (!chat.participants.map(String).includes(String(req.user._id))) return res.status(403).json({ error: 'Not a participant' });
    const msg = await Message.create({ chat: chat._id, sender: req.user._id, text: req.body.text });
    chat.lastMessage = req.body.text;
    await chat.save();
    const populated = await msg.populate('sender', 'name');
    io.to(`chat_${chat._id}`).emit('new_message', populated);
    // notify the other participant
    const other = chat.participants.find(p => String(p) !== String(req.user._id));
    if (other) await notify(other, 'new_message', `${req.user.name} sent a message`, req.body.text.substring(0, 80), { chatId: chat._id });
    res.status(201).json(populated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── REVIEW ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/reviews/job/:jobId', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job || job.status !== 'completed') return res.status(400).json({ error: 'Job not completed' });
    const { rating, comment, revieweeId } = req.body;
    const existing = await Review.findOne({ job: job._id, reviewer: req.user._id });
    if (existing) return res.status(409).json({ error: 'Already reviewed' });
    const review = await Review.create({ job: job._id, reviewer: req.user._id, reviewee: revieweeId, rating, comment: comment || '' });
    // update reviewee rating
    const reviews = await Review.find({ reviewee: revieweeId });
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    await User.findByIdAndUpdate(revieweeId, { rating: Math.round(avg * 10) / 10, ratingCount: reviews.length });
    res.status(201).json(review);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reviews/user/:userId', auth, async (req, res) => {
  try {
    const reviews = await Review.find({ reviewee: req.params.userId }).populate('reviewer', 'name').sort({ createdAt: -1 });
    res.json(reviews);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── UNLOCK ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/unlock/worker/:workerId/status', auth, studentOnly, async (req, res) => {
  try {
    const unlock = await ContactUnlock.findOne({ student: req.user._id, worker: req.params.workerId });
    if (unlock) {
      const worker = await User.findById(req.params.workerId).select('phone name');
      return res.json({ unlocked: true, phone: worker.phone });
    }
    res.json({ unlocked: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/unlock/worker/:workerId/initiate', auth, studentOnly, async (req, res) => {
  try {
    await ContactUnlock.create({ student: req.user._id, worker: req.params.workerId });
    const worker = await User.findById(req.params.workerId).select('phone name');
    res.json({ unlocked: true, phone: worker.phone });
  } catch (e) {
    if (e.code === 11000) {
      const worker = await User.findById(req.params.workerId).select('phone name');
      return res.json({ unlocked: true, phone: worker.phone });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join_user', (userId) => socket.join(`user_${userId}`));
  socket.on('join_chat', (chatId) => socket.join(`chat_${chatId}`));
  socket.on('leave_chat', (chatId) => socket.leave(`chat_${chatId}`));
  socket.on('typing_start', ({ chatId, userName }) => socket.to(`chat_${chatId}`).emit('user_typing', { userName }));
  socket.on('typing_stop', ({ chatId }) => socket.to(`chat_${chatId}`).emit('user_stopped_typing'));
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'PlugMe API running', version: '1.0.0' }));

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    try {
      await mongoose.connection.db.collection('jobs').dropIndex('location_2dsphere');
      console.log('Dropped geo index');
    } catch (e) {
      console.log('No geo index to drop');
    }
    server.listen(PORT, () => console.log(`PlugMe API running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
