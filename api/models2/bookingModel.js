const mongoose = require("mongoose");
let aggregatePaginate = require("mongoose-aggregate-paginate-v2");
let mongoosePaginate = require("mongoose-paginate-v2");

const bookingSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        booking_date: {
            type: Date,
            required: true,
        },
        booking_id: {
            type: String,
            required: true,
        },
        original_price: {
            type: Number,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

bookingSchema.plugin(aggregatePaginate);
bookingSchema.plugin(mongoosePaginate);
module.exports = mongoose.model("booking", bookingSchema);
