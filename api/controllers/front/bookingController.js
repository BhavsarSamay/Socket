const BookingModel = require('../../models2/bookingModel');
const PaymentModel = require('../../models2/paymentModel');
const helper = require("../../helper/helper");
const mongoose = require("mongoose");
const payment_process = require("../guest/paymentController");
const niv = require("node-input-validator"); // 👈 make sure you imported this

exports.add_booking = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {

        const validator = new niv.Validator(req.body, {
            booking_date: "required|string",
            price: "required|numeric",
        });

        const isValid = await validator.check();
        if (!isValid) {
            return res.status(422).json({
                message: "Validation error",
                errors: validator.errors,
            });
        }

        const user_id = req.userData._id;

        const {
            booking_date,
            price
        } = req.body;

        const bookingDateObj = new Date(booking_date);
        if (isNaN(bookingDateObj)) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Invalid booking date" });
        }

        let original_price = price || 0;
        let booking_id;
        let isUnique = false;
        let length = 6;

        while (!isUnique) {
            booking_id = helper.generateRandomString(length, true);
            const exists = await BookingModel.findOne({ booking_id }).session(session);

            if (!exists) {
                isUnique = true;
            } else {
                const min = Math.pow(10, length - 1);
                const max = Math.pow(10, length) - 1;
                const totalPossible = max - min + 1;

                const usedCount = await BookingModel.countDocuments({
                    booking_id: {
                        $gte: String(min),
                        $lte: String(max),
                    },
                }).session(session);

                if (usedCount >= totalPossible) {
                    length++;
                }
            }
        }

        const booking = new BookingModel({
            user_id,    
            booking_date: bookingDateObj,
            original_price,
            booking_id: booking_id,
        });

        await booking.save({ session });
        // booking._id="68afffc21292c4689509e4df"
        const paymentPayload = {
            user_id,
            booking_id: booking._id,
            amount: original_price,
            time: 1800
        };

        const payment_url = await payment_process.createPaymentLink(paymentPayload);

        if (!payment_url) {
            await session.abortTransaction();
            return res
                .status(500)
                .json({ message: "Failed to generate payment link" });
        }
        await session.commitTransaction();
        return res.status(201).json({
            message: "Booking added successfully",
            payment_url,
        });
    }
    catch (error) {
        await session.abortTransaction();
        next(error);
    } finally {
        session.endSession();
    }
};