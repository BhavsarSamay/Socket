const GroupModel = require('../../models2/GroupModel');
const GroupMemberModel = require('../../models2/GroupMemberModel');
const UserModel = require("../../models/userModel");
const niv = require('node-input-validator');
const mongoose = require("mongoose");

exports.createGroup = async (req, res, next) => {
    try {
        let { name, members } = req.body;
        const userId = req.userData._id;

        // Validation
        const objValidation = new niv.Validator(req.body, {
            name: "required",
            members: "required",
        });

        const matched = await objValidation.check();
        if (!matched) {
            return res.status(422).send({
                message: "Validation error",
                errors: objValidation.errors,
            });
        }

        if (typeof members === "string") {
            members = members.split(",").map((id) => id.trim());
        }

        members = [...new Set(members.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id));

        if (!members.map(id => id.toString()).includes(userId.toString())) {
            members.push(new mongoose.Types.ObjectId(userId));
        }

        const checkGroup = await GroupModel.findOne({
            $expr: {
                $eq: [{ $toLower: "$name" }, name.trim().toLowerCase()],
            },
        });

        if (checkGroup) {
            return res.status(409).send({
                message: "Group name already exists.",
            });
        }

        const group = await GroupModel.create({ name });

        const memberDocs = members.map(memberId => ({
            group_id: group._id,
            member: memberId,
        }));

        await GroupMemberModel.insertMany(memberDocs);

        return res.status(201).json({
            message: "Group created successfully.",
            group_id: group._id,
        });
    } catch (error) {
        next(error);
    }
};

exports.addMembers = async (req, res, next) => {
    try {
        let { group_id, members } = req.body;
        const userId = req.userData._id;

        const objValidation = new niv.Validator(req.body, {
            group_id: "required",
            members: "required",
        });

        const matched = await objValidation.check();
        if (!matched) {
            return res.status(422).send({
                message: "Validation error",
                errors: objValidation.errors,
            });
        }

        if (typeof members === "string") {
            members = members.split(",").map((id) => id.trim());
        }

        members = [...new Set(members.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id));

        // Check if group exists
        const group = await GroupModel.findById(group_id);
        if (!group) {
            return res.status(404).send({
                message: "Group not found.",
            });
        }

        const isMember = await GroupMemberModel.exists({ group_id, member: userId });
        if (!isMember) {
            return res.status(403).send({
                message: "You are not authorized to add members to this group.",
            });
        }

        const memberDocs = members.map(memberId => ({
            group_id,
            member: memberId,
        }));

        await GroupMemberModel.insertMany(memberDocs);

        return res.status(200).json({
            message: "Members added successfully.",
            group_id,
        });
    }
    catch (error) {
        next(error);
    }
}