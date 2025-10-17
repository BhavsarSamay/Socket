const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const MessageSchema = mongoose.Schema(
    {
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
        },
        to:
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: true,
        },
        content:
        {
            type: String,
            default: ""
        },
        media_type: {
            type: String,
            enum: ["text", "image", "video", "file"],
            default: "text",
        },
    },
    { timestamps: true }
);

MessageSchema.index({ status: -1 });

MessageSchema.plugin(aggregatePaginate);
MessageSchema.plugin(mongoosePaginate);

module.exports = mongoose.model("message", MessageSchema);
