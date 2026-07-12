require('dotenv').config();
const bcrypt = require('bcrypt');
const { connectDatabase, User, mongoose } = require('../database');

async function run() {
  await connectDatabase();

  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    console.log(`Admin user already exists: ${existing.username} <${existing.email}>`);
    await mongoose.disconnect();
    return;
  }

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
  const password_hash = await bcrypt.hash(password, saltRounds);

  const admin = await User.create({
    username,
    email,
    password_hash,
    role: 'admin',
    balance: 0,
  });

  console.log(`Created admin user: ${admin.username} <${admin.email}>`);
  console.log('Log in with the password set in SEED_ADMIN_PASSWORD (.env) and change it afterward if needed.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Failed to seed admin user:', err);
  process.exit(1);
});
