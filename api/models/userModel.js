const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");
const validate = require("validator");

const UserSchema = mongoose.Schema(
    {
        name: {
            type: String,
            required: false,
        },
        number:
        {
            type: String,
            required: true
        },
        country_code: {
            type: String,
            required: true,
        },
        profile_pic: {
            type: String,
            default: "",
        },
        status: {
            type: Number,
            default: 1, // 1=active, 2=inactive
        },
        version: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

UserSchema.index({ status: -1 });

UserSchema.plugin(aggregatePaginate);
UserSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("user", UserSchema);
