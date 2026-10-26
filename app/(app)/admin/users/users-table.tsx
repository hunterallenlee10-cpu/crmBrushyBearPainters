"use client";

import * as React from "react";
import Link from "next/link";
import { SearchIcon, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  countByStatus,
  filterUsers,
  type UserListRow,
  type UserStatusFilter,
} from "@/lib/validation/users";
import { TOUCH } from "./_components/form-bits";

export type UserRow = UserListRow & { invited: string; isYou: boolean };

const TABS: { value: UserStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Deactivated" },
  { value: "all", label: "All" },
];

export function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="neutral">Deactivated</Badge>
  );
}

export function UsersTable({ rows, canManage }: { rows: UserRow[]; canManage: boolean }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<UserStatusFilter>("active");
  const counts = countByStatus(rows);
  const visible = filterUsers(rows, query, status);

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5" aria-label="Users">
      <Tabs value={status} onValueChange={(v) => setStatus(v as UserStatusFilter)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label="Filter by status" className="h-11 w-full sm:h-9 sm:w-fit">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3 text-foreground/85">
                {t.label}
                <span className="rounded-full bg-card px-1.5 text-xs text-foreground tabular-nums">
                  {counts[t.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, role…"
              aria-label="Search users"
              className={`${TOUCH} pl-8`}
            />
          </div>
        </div>

        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {visible.length === 0 ? (
              <EmptyList query={query} status={status} canManage={canManage} />
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="whitespace-normal">Title / department</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Invited</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/admin/users/${u.id}`}
                              className="text-bb-forest underline-offset-4 hover:underline"
                            >
                              {u.fullName}
                            </Link>
                            {u.isYou && (
                              <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                            )}
                            <span className="block text-xs font-normal text-muted-foreground">
                              {u.email}
                            </span>
                          </TableCell>
                          <TableCell>{u.roleName}</TableCell>
                          <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
                            {[u.title, u.department].filter(Boolean).join(" · ") || "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge active={u.isActive} />
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {u.invited}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <ul className="flex flex-col divide-y md:hidden" aria-label="Users list">
                  {visible.map((u) => (
                    <li key={u.id}>
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="flex min-h-11 flex-col gap-1 py-3"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium text-bb-forest">
                            {u.fullName}
                            {u.isYou && (
                              <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                            )}
                          </span>
                          <StatusBadge active={u.isActive} />
                        </span>
                        <span className="truncate text-sm text-muted-foreground">{u.email}</span>
                        <span className="text-sm">
                          {u.roleName}
                          {u.title ? ` · ${u.title}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function EmptyList({
  query,
  status,
  canManage,
}: {
  query: string;
  status: UserStatusFilter;
  canManage: boolean;
}) {
  const Icon = query ? SearchIcon : status === "deactivated" ? Users : UserPlus;
  const message = query
    ? `No users match "${query.trim()}". Try a name, email or role.`
    : status === "deactivated"
      ? "No one is deactivated. Deactivated users keep their history and can be reactivated."
      : canManage
        ? "No users yet. Use Invite user to add your team."
        : "No users to show yet.";
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <Icon className="size-6" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
