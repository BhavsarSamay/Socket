const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const MessageSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        group_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "chatGroup",
            required: true,
        },
        message: {
            type: String,
        },
        img: {
            type: String,
        },
    },
    { timestamps: true }
);

MessageSchema.index({ status: -1 });

MessageSchema.plugin(aggregatePaginate);
MessageSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("chat_message", MessageSchema);
