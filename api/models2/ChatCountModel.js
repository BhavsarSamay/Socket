const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const ChatCountSchema = mongoose.Schema(
    {
        group_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "chat_group",
            required: false,
        },
        to_user:
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: false
        },
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        last_msg_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "chat_message",
            required: true,
        },
    },
    { timestamps: false }
);

ChatCountSchema.plugin(aggregatePaginate);
ChatCountSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("chat_count", ChatCountSchema);