
const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const ChatGroupMemberSchema = mongoose.Schema(
    {
        member: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
        },
        group_id:
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "chat_groups",
        }
    },
    { timestamps: true }
);

ChatGroupMemberSchema.index({ status: -1 });

ChatGroupMemberSchema.plugin(aggregatePaginate);
ChatGroupMemberSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("group_member", ChatGroupMemberSchema);

