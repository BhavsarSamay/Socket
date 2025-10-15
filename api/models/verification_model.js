const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const LoginVerificationSchema = mongoose.Schema(
  {
    country_code: {
      type: String,
      default: "",
    },
    number: {
      type: String,
      default: "",
    },
    otp: {
      type: String,
      default: "",
    },
    email:
    {
      type: String,
      default: "",
    },
    token: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

LoginVerificationSchema.plugin(aggregatePaginate);
LoginVerificationSchema.plugin(mongoosePaginate);
module.exports = mongoose.model("login_verification", LoginVerificationSchema);
