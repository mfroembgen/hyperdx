import {
  ONBOARDING_TASK_IDS,
  type OnboardingData,
} from '@hyperdx/common-utils/dist/types';
// @ts-expect-error don't install the @types for this package, as it conflicts with mongoose
import passportLocalMongoose from '@hyperdx/passport-local-mongoose';
import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

export interface IUser {
  _id: ObjectId;
  accessKey: string;
  createdAt: Date;
  email: string;
  name: string;
  // Optional for docs predating this field; the `me` route defaults it.
  onboardingData?: OnboardingData;
  team: ObjectId;
}

interface UserVirtuals {
  id: string;
  hasPasswordAuth: boolean;
}
type UserModel = mongoose.Model<
  IUser,
  Record<string, never>,
  Record<string, never>,
  UserVirtuals
>;
export type UserDocument = mongoose.HydratedDocument<IUser, UserVirtuals>;

const UserSchema = new Schema<
  IUser,
  UserModel,
  Record<string, never>,
  Record<string, never>,
  UserVirtuals
>(
  {
    name: String,
    email: {
      type: String,
      required: true,
    },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    accessKey: {
      type: String,
      default: function genUUID() {
        return uuidv4();
      },
    },
    onboardingData: {
      type: new Schema<OnboardingData>(
        {
          completedTasks: {
            type: [String],
            enum: ONBOARDING_TASK_IDS,
            default: [],
          },
          isDismissed: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: () => ({ completedTasks: [], isDismissed: false }),
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.virtual('hasPasswordAuth').get(function (this: IUser) {
  return true;
});

UserSchema.plugin(passportLocalMongoose, {
  usernameField: 'email',
  usernameLowerCase: true,
  usernameCaseInsensitive: true,
});

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ accessKey: 1 }, { unique: true });

export default mongoose.model<IUser, UserModel>('User', UserSchema);
