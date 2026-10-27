import type { JobOptions } from "@/lib/jobs/options";
import type { GateContext } from "@/lib/domain/jobs/gates";
import type { HealthFactor } from "@/lib/domain/jobs/health";
import type {
  AppointmentStatus,
  AppointmentType,
  JobPriority,
  JobSectionId,
  JobStatus,
  MilestoneField,
  OnTimeStatus,
  WalkthroughResult,
} from "@/lib/domain/jobs/constants";
import type { JobStageId } from "@/lib/domain/stages";

/** Serializable data the Job Detail server page hands to its client parts. */

export type JobProperty = {
  id: string;
  address: string | null;
  city: string | null;
  yearBuilt: number | null;
  leadSafe: boolean;
  propertyType: string | null;
  stories: number | null;
  sidingType: string | null;
  hasHoa: boolean;
  hoaName: string | null;
  hoaColorApproval: boolean;
  accessNotes: string | null;
  pets: string | null;
  parking: string | null;
  occupancy: string | null;
};

export type JobContact = {
  id: string;
  name: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
};

export type JobRecord = {
  id: string;
  number: string;
  name: string;
  stage: JobStageId;
  status: JobStatus;
  stageEnteredAt: string;
  lostReason: string | null;
  priority: JobPriority;
  priorityReason: string | null;
  workTypes: string[];
  accountId: string;
  accountName: string | null;
  accountJobCount: number;
  property: JobProperty | null;
  propertyId: string | null;
  contact: JobContact | null;
  contactId: string | null;
  leadId: string | null;
  leadSource: string | null;
  leadSubSource: string | null;
  territoryName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  pocId: string | null;
  pocName: string | null;
  pmId: string | null;
  pmName: string | null;
  targetSeason: number | null;
  promisedStartDate: string | null;
  actualStartDate: string | null;
  estimatedDurationDays: number | null;
  estimatedCompletionDate: string | null;
  tags: string[];
  healthScore: number | null;
  healthFactors: HealthFactor[];
  healthCheckedAt: string | null;
  onTimeStatus: OnTimeStatus;
  milestones: Record<MilestoneField, string | null>;
  createdAt: string;
  updatedAt: string;
};

export type HoldItem = {
  id: string;
  type: string;
  label: string;
  reason: string;
  blocksScheduling: boolean;
  placedAt: string;
  placedByName: string | null;
  releasedAt: string | null;
  releasedByName: string | null;
  releaseNote: string | null;
};

export type AppointmentItem = {
  id: string;
  type: AppointmentType;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  result: WalkthroughResult | null;
  assignees: { id: string; name: string }[];
  notes: string | null;
};

export type PendingApproval = {
  id: string;
  toStage: JobStageId;
  reason: string;
  requestedAt: string;
  requestedByName: string | null;
  mine: boolean;
};

export type HistoryItem = {
  id: string;
  from: JobStageId | null;
  to: JobStageId;
  at: string;
  byName: string | null;
  override: boolean;
  reason: string | null;
};

export type ActivityItem = {
  id: string;
  summary: string;
  at: string;
  byName: string | null;
};

export type JobPermissions = {
  /** Edit job fields, place/release holds (scope-checked for this job). */
  update: boolean;
  assign: boolean;
  advance: boolean;
  /** Owners: override gates, Admin section, milestone dates, contract baseline. */
  override: boolean;
  delete: boolean;
  readFinancials: boolean;
  readAppointments: boolean;
  manageAppointments: boolean;
  readMessages: boolean;
  readNotes: boolean;
  readTasks: boolean;
};

export type JobDetailData = {
  job: JobRecord;
  options: JobOptions;
  /** Labels for property picklists (siding, home type). */
  propertyLabels: { siding: Record<string, string>; propertyType: Record<string, string> };
  holds: HoldItem[];
  appointments: AppointmentItem[];
  pendingApproval: PendingApproval | null;
  history: HistoryItem[];
  recentActivity: ActivityItem[];
  contractCents: number | null;
  gate: GateContext;
  counts: { notes: number | null; openTasks: number | null; tasksDue: number | null };
  can: JobPermissions;
  viewerId: string;
  readOnly: boolean;
  section: JobSectionId;
};
