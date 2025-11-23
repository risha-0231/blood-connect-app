const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  userId: String,
  name: String,
  phone: String,
  userRole: String,
  pinCode: String,
  bloodType: String,
  age: Number,
  weight: Number,
  gender: String,
  address: String,
  status: { type: String, default: 'PENDING_VERIFICATION' },
  lastDonationTime: Number,
  isRequestActive: Boolean,
  bloodReportLink: String
});

module.exports = mongoose.model('User', UserSchema);
