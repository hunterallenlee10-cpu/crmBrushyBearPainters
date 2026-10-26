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
import { cn } from "@/lib/utils";
import { selectClass } from "./labels";
import { addTask, setTaskStatus } from "./actions";
import { TASK_PRIORITIES, taskSchema, type TaskPriority } from "./schemas";
import type { LeadDetailData, TaskItem } from "./types";

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
};

type Errors = Record<string, string | undefined>;

function AddTaskForm({ data, onDone }: { data: LeadDetailData; onDone: () => void }) {
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [dueTime, setDueTime] = React.useState("");
  const [assignee, setAssignee] = React.useState(data.viewerId);
  const [priority, setPriority] = React.useState<TaskPriority>("normal");
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, startTransition] = React.useTransition();
  const people = data.options.users;
  const hasMe = people.some((u) => u.value === data.viewerId);

  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        const input = {
          lead_id: data.lead.id,
          title,
          due_date: dueDate,
          due_time: dueTime,
          assignee_id: assignee,
          priority,
        };
        const parsed = taskSchema.safeParse(input);
        if (!parsed.success) {
          const out: Errors = {};
          for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
          return setErrors(out);
        }
        setErrors({});
        startTransition(async () => {
          const r = await addTask(input);
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
        id="task-title"
        label="Task"
        required
        error={errors.title}
        className="sm:col-span-2 lg:col-span-1"
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Call back about exterior colors"
          {...fieldAria("task-title", errors.title)}
        />
      </Field>
      <Field id="task-date" label="Due date" error={errors.due_date}>
        <Input
          type="date"
          value={dueDate}
          min={pacificIsoDate()}
          onChange={(e) => setDueDate(e.target.value)}
          {...fieldAria("task-date", errors.due_date)}
        />
      </Field>
      <Field id="task-time" label="Time (Pacific)" error={errors.due_time}>
        <Input
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          {...fieldAria("task-time", errors.due_time)}
        />
      </Field>
      <Field id="task-assignee" label="Assigned to" error={errors.assignee_id}>
        <select
          id="task-assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className={selectClass}
        >
          {!hasMe && <option value={data.viewerId}>Me</option>}
          {people.map((u) => (
            <option key={u.value} value={u.value}>
              {u.value === data.viewerId ? `${u.label} (me)` : u.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="task-priority" label="Priority">
        <select
          id="task-priority"
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

function TaskRow({ task, data }: { task: TaskItem; data: LeadDetailData }) {
  const [pending, startTransition] = React.useTransition();
  const done = task.status === "done";
  const id = `task-${task.id}`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={done}
        disabled={!data.can.manageTasks || pending}
        aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” done`}
        onCheckedChange={(v) =>
          startTransition(async () => {
            const r = await setTaskStatus({ id: task.id, lead_id: data.lead.id, done: v === true });
            if (r.ok) toast.success(v === true ? "Task done." : "Task reopened.");
            else toast.error(r.error.message);
          })
        }
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}
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

export function TasksTab({ data }: { data: LeadDetailData }) {
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const open = data.tasks.filter((t) => t.status === "open");
  const doneCount = data.tasks.length - open.length;
  const visible = showCompleted ? data.tasks : open;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="show-completed" checked={showCompleted} onCheckedChange={setShowCompleted} />
          <Label htmlFor="show-completed">Show completed ({doneCount})</Label>
        </div>
        {data.can.manageTasks && !adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add Task
          </Button>
        )}
      </div>

      {data.can.manageTasks && adding && (
        <section aria-labelledby="add-task-title" className="rounded-2xl border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="add-task-title" className="text-base font-semibold">
              Add a follow-up task
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Close
            </Button>
          </div>
          <AddTaskForm data={data} onDone={() => setAdding(false)} />
        </section>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={data.tasks.length === 0 ? "No tasks yet" : "All caught up"}
          action={
            data.can.manageTasks && !adding ? (
              <Button variant="cta" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add Task
              </Button>
            ) : undefined
          }
        >
          {data.tasks.length === 0
            ? "No tasks yet. Add a follow-up to stay on top of this lead."
            : "Every task on this lead is done. Turn on “Show completed” to see them."}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card" aria-label="Tasks">
          {visible.map((t) => (
            <TaskRow key={t.id} task={t} data={data} />
          ))}
        </ul>
      )}
      {data.truncated.tasks && (
        <p className="text-xs text-muted-foreground">Showing the first 200 tasks.</p>
      )}
    </div>
  );
}
