const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RequestSchema = new Schema({
  requesterId: String,
  name: String,
  phone: String,
  userRole: String,
  pinCode: String,
  bloodTypeNeeded: String,
  status: { type: String, default: 'PENDING' }
});

module.exports = mongoose.model('Request', RequestSchema);
