"use client";

import * as React from "react";
import { ListTodo, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/layout/empty-state";
import { Field, fieldAria } from "@/components/forms/field";
import { formatAppointment, formatDateTime, pacificIsoDate } from "@/lib/format/dates";
import type { Option } from "@/lib/leads/service";
import { cn } from "@/lib/utils";
import { selectClass } from "@/app/(app)/leads/[id]/labels";
import { TASK_PRIORITIES, type TaskPriority } from "@/app/(app)/leads/[id]/schemas";
import { addJobTask, setJobTaskStatus } from "./actions";
import { jobTaskSchema } from "./schemas";

export type JobTask = {
  id: string;
  title: string;
  dueAt: string | null;
  status: "open" | "done";
  priority: TaskPriority;
  assigneeName: string | null;
  completedAt: string | null;
  overdue: boolean;
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

type Errors = Record<string, string | undefined>;

function AddTaskForm({
  jobId,
  users,
  viewerId,
  onDone,
}: {
  jobId: string;
  users: Option[];
  viewerId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [dueTime, setDueTime] = React.useState("");
  const [assignee, setAssignee] = React.useState(viewerId);
  const [priority, setPriority] = React.useState<TaskPriority>("normal");
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, startTransition] = React.useTransition();
  const hasMe = users.some((u) => u.value === viewerId);

  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        const input = {
          job_id: jobId,
          title,
          due_date: dueDate,
          due_time: dueTime,
          assignee_id: assignee,
          priority,
        };
        const parsed = jobTaskSchema.safeParse(input);
        if (!parsed.success) {
          const out: Errors = {};
          for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
          return setErrors(out);
        }
        setErrors({});
        startTransition(async () => {
          const r = await addJobTask(input);
          if (r.ok) {
            toast.success("Task added.");
            setTitle("");
            setDueDate("");
            setDueTime("");
            setPriority("normal");
            onDone();
          } else {
            const out: Errors = {};
            for (const [k, v] of Object.entries(r.error.fieldErrors ?? {})) out[k] = v[0];
            setErrors(out);
            toast.error(r.error.message);
          }
        });
      }}
    >
      <Field
        id="job-task-title"
        label="Task"
        required
        error={errors.title}
        className="sm:col-span-2 lg:col-span-1"
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Confirm trim colors with the customer"
          {...fieldAria("job-task-title", errors.title)}
        />
      </Field>
      <Field id="job-task-date" label="Due date" error={errors.due_date}>
        <Input
          type="date"
          value={dueDate}
          min={pacificIsoDate()}
          onChange={(e) => setDueDate(e.target.value)}
          {...fieldAria("job-task-date", errors.due_date)}
        />
      </Field>
      <Field id="job-task-time" label="Time (Pacific)" error={errors.due_time}>
        <Input
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          {...fieldAria("job-task-time", errors.due_time)}
        />
      </Field>
      <Field id="job-task-assignee" label="Assigned to" error={errors.assignee_id}>
        <select
          id="job-task-assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className={selectClass}
        >
          {!hasMe && <option value={viewerId}>Me</option>}
          {users.map((u) => (
            <option key={u.value} value={u.value}>
              {u.value === viewerId ? `${u.label} (me)` : u.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="job-task-priority" label="Priority">
        <select
          id="job-task-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className={selectClass}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end sm:col-span-2 lg:col-span-1 lg:h-full lg:pt-6">
        <Button type="submit" disabled={pending} className="w-full lg:w-auto">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Add task
        </Button>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-6">
        A date without a time is due at 5:00 PM Pacific.
      </p>
    </form>
  );
}

function TaskRow({ task, jobId, canManage }: { task: JobTask; jobId: string; canManage: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const done = task.status === "done";
  const id = `job-task-${task.id}`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={done}
        disabled={!canManage || pending}
        aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” done`}
        onCheckedChange={(v) =>
          startTransition(async () => {
            const r = await setJobTaskStatus({ id: task.id, job_id: jobId, done: v === true });
            if (r.ok) toast.success(v === true ? "Task done." : "Task reopened.");
            else toast.error(r.error.message);
          })
        }
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn(
            "text-sm font-medium break-words",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </label>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span className={cn(task.overdue && "font-medium text-danger")}>
            {task.dueAt ? `Due ${formatAppointment(task.dueAt)}` : "No due date"}
            {task.overdue && " · overdue"}
          </span>
          <span>{task.assigneeName ?? "Someone"}</span>
          {done && task.completedAt && <span>Done {formatDateTime(task.completedAt)}</span>}
        </p>
      </div>
      {task.priority !== "normal" && (
        <Badge variant={task.priority === "high" ? "warning" : "neutral"}>
          {PRIORITY_LABELS[task.priority]}
        </Badge>
      )}
    </li>
  );
}

export function JobTasks({
  jobId,
  tasks,
  canManage,
  readOnly,
  users,
  viewerId,
  truncated,
}: {
  jobId: string;
  tasks: JobTask[];
  canManage: boolean;
  readOnly: boolean;
  users: Option[];
  viewerId: string;
  truncated: boolean;
}) {
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const open = tasks.filter((t) => t.status === "open");
  const doneCount = tasks.length - open.length;
  const visible = showCompleted ? tasks : open;
  const overdue = open.filter((t) => t.overdue).length;

  return (
    <section aria-labelledby="job-tasks-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="job-tasks-title" className="text-base font-semibold">
          Tasks
          <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
            {open.length} open{overdue ? ` · ${overdue} overdue` : ""}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="job-show-completed"
              checked={showCompleted}
              onCheckedChange={setShowCompleted}
            />
            <Label htmlFor="job-show-completed">Show completed ({doneCount})</Label>
          </div>
          {canManage && !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add Task
            </Button>
          )}
        </div>
      </div>
      {readOnly && (
        <p className="text-xs text-muted-foreground">
          You&apos;re viewing as another user. Exit View as user to add or complete tasks.
        </p>
      )}

      {canManage && adding && (
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Add a follow-up task</h3>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Close
            </Button>
          </div>
          <AddTaskForm
            jobId={jobId}
            users={users}
            viewerId={viewerId}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={tasks.length === 0 ? "No tasks yet" : "All caught up"}
          className="py-8"
          action={
            canManage && !adding ? (
              <Button variant="cta" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add Task
              </Button>
            ) : undefined
          }
        >
          {tasks.length === 0
            ? "No tasks yet. Add a follow-up to stay on top of this job."
            : "Every task on this job is done. Turn on “Show completed” to see them."}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card" aria-label="Tasks">
          {visible.map((t) => (
            <TaskRow key={t.id} task={t} jobId={jobId} canManage={canManage} />
          ))}
        </ul>
      )}
      {truncated && <p className="text-xs text-muted-foreground">Showing the first 200 tasks.</p>}
    </section>
  );
}
