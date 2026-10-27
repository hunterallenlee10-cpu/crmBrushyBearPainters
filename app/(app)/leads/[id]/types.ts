import type { LeadOptions } from "@/lib/leads/service";
import type {
  Grade,
  HomeBuilt,
  LeadStatus,
  Service,
  Temperature,
  Timeline,
} from "@/lib/domain/leads/constants";
import type { CommentCategory, NotePriority, TaskPriority } from "./schemas";
import type { LeadTab } from "./utils";

/** Serializable data the Lead Detail server page hands to its client parts. */

export type LeadRecord = {
  id: string;
  name: string;
  initials: string;
  firstName: string;
  lastName: string | null;
  company: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  unit: string | null;
  city: string | null;
  state: string;
  zip: string | null;
  address: string | null;
  outOfArea: boolean;
  territoryName: string | null;
  services: Service[];
  timeline: Timeline | null;
  homeBuilt: HomeBuilt | null;
  yearBuilt: number | null;
  leadSafe: boolean;
  propertyType: string | null;
  stories: number | null;
  sidingType: string | null;
  hasHoa: boolean | null;
  customerNotes: string | null;
  status: LeadStatus;
  disposition: string | null;
  smsOptedOutAt: string | null;
  lostReason: string | null;
  leadSource: string;
  leadSubSource: string | null;
  leadSetById: string | null;
  leadSetByName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  score: number | null;
  grade: Grade | null;
  temperature: Temperature | null;
  factors: { label: string; points: number }[];
  scoredAt: string | null;
  walkthroughAt: string | null;
  nurtureUntil: string | null;
  firstContactedAt: string | null;
  speedToLeadSeconds: number | null;
  intakeChannel: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type ThreadItem =
  | {
      kind: "message";
      id: string;
      at: string;
      channel: "sms" | "email" | "call" | "voicemail" | "portal";
      direction: "outbound" | "inbound";
      status: string;
      simulated: boolean;
      to: string | null;
      subject: string | null;
      body: string | null;
      callOutcome: string | null;
      callDurationSeconds: number | null;
      byName: string | null;
      /** Sent by a workflow or campaign. */
      automatic: boolean;
    }
  | {
      kind: "event";
      id: string;
      at: string;
      type: string;
      summary: string;
      byName: string | null;
    };

export type NoteItem = {
  id: string;
  body: string;
  pinned: boolean;
  priority: NotePriority;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  mine: boolean;
};

export type CommentItem = {
  id: string;
  body: string;
  category: CommentCategory;
  mentions: { id: string; name: string }[];
  createdAt: string;
  editedAt: string | null;
  authorName: string | null;
  mine: boolean;
};

export type TaskItem = {
  id: string;
  title: string;
  dueAt: string | null;
  status: "open" | "done";
  priority: TaskPriority;
  assigneeId: string;
  assigneeName: string | null;
  completedAt: string | null;
  overdue: boolean;
};

export type PhotoItem = {
  id: string;
  fileName: string;
  url: string | null;
  isImage: boolean;
  source: string;
  createdAt: string;
};

export type LeadPermissions = {
  /** Edit fields, change status, book a walkthrough (scope-checked for this lead). */
  update: boolean;
  assign: boolean;
  delete: boolean;
  send: boolean;
  readMessages: boolean;
  readNotes: boolean;
  writeNotes: boolean;
  readTasks: boolean;
  manageTasks: boolean;
  /** Owners/admins see the link to Admin → Lead Scoring. */
  manageScoring: boolean;
};

export type LeadDetailData = {
  lead: LeadRecord;
  options: LeadOptions;
  thread: ThreadItem[];
  /** The customer conversation's read state (SPEC §5.7), when one exists. */
  conversation: { id: string; unread: boolean; lastInboundAt: string | null } | null;
  templates: { key: string; name: string; channel: "sms" | "email" }[];
  notes: NoteItem[];
  comments: CommentItem[];
  tasks: TaskItem[];
  photos: PhotoItem[];
  can: LeadPermissions;
  viewerId: string;
  readOnly: boolean;
  initialTab: LeadTab;
  openBooking: boolean;
  /** Lists are capped; true when there may be older rows than shown. */
  truncated: { thread: boolean; notes: boolean; comments: boolean; tasks: boolean };
};
