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
  workosIssuer?: string;
  workosSubject?: string;
  createdAt: Date;
  email: string;
  name: string;
  // Optional for docs predating this field; the `me` route defaults it.
  onboardingData?: OnboardingData;
  team: ObjectId;
}

export type UserDocument = mongoose.HydratedDocument<IUser>;

const UserSchema = new Schema(
  {
    name: String,
    workosIssuer: String,
    workosSubject: String,
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

UserSchema.plugin(passportLocalMongoose, {
  usernameField: 'email',
  usernameLowerCase: true,
  usernameCaseInsensitive: true,
});

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index(
  { workosIssuer: 1, workosSubject: 1 },
  {
    unique: true,
    partialFilterExpression: {
      workosIssuer: { $type: 'string' },
      workosSubject: { $type: 'string' },
    },
  },
);
UserSchema.index({ accessKey: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
