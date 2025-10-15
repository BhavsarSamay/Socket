const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const ChatGroupMemberSchema = mongoose.Schema(
    {
        group_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "booking",
            required: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
    },
    { timestamps: true }
);

ChatGroupMemberSchema.plugin(aggregatePaginate);
ChatGroupMemberSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("chat_member", ChatGroupMemberSchema);
