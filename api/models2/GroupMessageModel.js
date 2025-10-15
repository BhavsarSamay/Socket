const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const ChatGroupMessageSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
        },
        group_id:
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "chat_groups",
        },
        content:
        {
            type: String,
            required: true,
        },
    },
    { timestamps: true }
);

ChatGroupMessageSchema.index({ status: -1 });

ChatGroupMessageSchema.plugin(aggregatePaginate);
ChatGroupMessageSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("group_message", ChatGroupMessageSchema);
