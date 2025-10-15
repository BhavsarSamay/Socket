const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const ChatGroupSchema = mongoose.Schema(
    {
        name: {
            type: String,
            default: "",
        },
        status: {
            type: Number,
            default: 1, // 1=active, 2=inactive
        },
    },
    { timestamps: true }
);

ChatGroupSchema.index({ status: -1 });

ChatGroupSchema.plugin(aggregatePaginate);
ChatGroupSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("group", ChatGroupSchema);
