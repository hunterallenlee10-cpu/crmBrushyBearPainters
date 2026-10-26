import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Layers, Plus, UserRound, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/lib/auth/viewer";
import {
  loadRolesModel,
  loadUserCounts,
  loadUsersPage,
  USERS_PAGE_SIZE,
  type UserCounts,
} from "./data";
import {
  countPermissions,
  groupPacks,
  isRolesTab,
  plural,
  resolveTemplate,
  type PackView,
  type TemplateView,
} from "./model";
import { PackBadge, TemplateBadges } from "./_components/badges";
import { DeleteRecordDialog } from "./_components/delete-record-dialog";
import { NewTemplateDialog } from "./_components/new-template-dialog";
import { RolesTabs } from "./_components/roles-tabs";

export const metadata: Metadata = { title: "Roles & Permissions" };

type SearchParams = Promise<{ tab?: string; page?: string }>;

export default async function RolesPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("roles:manage");
  const sp = await searchParams;
  const tab = isRolesTab(sp.tab) ? sp.tab : "overview";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [{ templates, packs }, counts, usersPage] = await Promise.all([
    loadRolesModel(),
    loadUserCounts(),
    loadUsersPage(page),
  ]);
  const packsById = new Map(packs.map((p) => [p.id, p]));
  const permCount = new Map(
    templates.map((t) => [t.id, countPermissions(resolveTemplate(t, t.packIds, packsById))]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles & Permissions"
        description="Who can see and do what. Permission packs make up role templates; each user gets one template plus any per-user changes."
      />
      <RolesTabs initial={tab}>
        <TabsContent value="overview" className="flex flex-col gap-6">
          <Explainer />
          <TemplateCards templates={templates} counts={counts} permCount={permCount} />
          <PackMatrix templates={templates} packs={packs} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab templates={templates} counts={counts} permCount={permCount} />
        </TabsContent>
        <TabsContent value="packs">
          <PacksTab packs={packs} templates={templates} />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab page={page} data={usersPage} templates={templates} />
        </TabsContent>
      </RolesTabs>
    </div>
  );
}

function Explainer() {
  const steps = [
    {
      icon: Layers,
      title: "Permission packs",
      body: "Building blocks. Each pack is a set of permissions, some with a record scope: own records, team, or everyone's.",
    },
    {
      icon: UsersRound,
      title: "Role templates",
      body: "A template is a set of packs. A user holds every permission in their template's packs, at the widest scope any pack gives.",
    },
    {
      icon: UserRound,
      title: "Users",
      body: "Each user has one template. On a user's page you can grant or revoke single permissions for that person; a revoke always wins.",
    },
  ];
  return (
    <section aria-labelledby="how-it-works" className="rounded-2xl border bg-card p-5">
      <h2 id="how-it-works" className="text-base font-semibold">
        How access fits together
      </h2>
      <ol className="mt-3 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl bg-muted/50 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-bb-forest">
              <s.icon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {i + 1}. {s.title}
              </p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">
        The database enforces all of this, not just the screens. The Owner template always has every
        permission and is locked; built-in packs are read-only, so make a custom pack or copy a
        template to change things.
      </p>
    </section>
  );
}

function userCountLabel(counts: UserCounts, id: string) {
  const c = counts.get(id) ?? { active: 0, inactive: 0 };
  return {
    active: c.active,
    text: plural(c.active, "user"),
    extra: c.inactive > 0 ? `+${c.inactive} deactivated` : null,
  };
}

function TemplateCards({
  templates,
  counts,
  permCount,
}: {
  templates: TemplateView[];
  counts: UserCounts;
  permCount: Map<string, number>;
}) {
  return (
    <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
      <h2 id="templates-heading" className="text-base font-semibold">
        Role templates
      </h2>
      <ul aria-label="Role templates" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {templates.map((t) => {
          const users = userCountLabel(counts, t.id);
          return (
            <li
              key={t.id}
              aria-label={t.name}
              className="flex flex-col gap-2 rounded-2xl border bg-card p-4"
            >
              <Link
                href={`/admin/roles/templates/${t.id}`}
                className="font-semibold text-bb-forest hover:underline"
              >
                {t.name}
              </Link>
              <TemplateBadges template={t} />
              {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
              <dl className="mt-auto grid grid-cols-2 gap-2 pt-2 text-sm">
                <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                  <dt className="text-xs text-muted-foreground">Users</dt>
                  <dd className="font-semibold" data-testid="template-user-count">
                    {users.text}
                    {users.extra && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {users.extra}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                  <dt className="text-xs text-muted-foreground">Permissions</dt>
                  <dd className="font-semibold">
                    {t.grantsAll ? "All" : (permCount.get(t.id) ?? 0)}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PackMatrix({ templates, packs }: { templates: TemplateView[]; packs: PackView[] }) {
  const groups = groupPacks(packs);
  return (
    <section aria-labelledby="matrix-heading" className="rounded-2xl border bg-card p-5">
      <h2 id="matrix-heading" className="text-base font-semibold">
        Packs in each template
      </h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
        A tick means the template includes that pack. Owner has every permission without packs.
      </p>
      <Table aria-label="Packs by template">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-48 bg-card">Pack</TableHead>
            {templates.map((t) => (
              <TableHead key={t.id} className="min-w-24 text-center text-xs whitespace-normal">
                {t.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <MatrixGroup key={g.category} label={g.label} packs={g.packs} templates={templates} />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function MatrixGroup({
  label,
  packs,
  templates,
}: {
  label: string;
  packs: PackView[];
  templates: TemplateView[];
}) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell
          colSpan={templates.length + 1}
          className="py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {label}
        </TableCell>
      </TableRow>
      {packs.map((p) => (
        <TableRow key={p.id}>
          <TableCell className="sticky left-0 z-10 bg-card">
            <Link href={`/admin/roles/packs/${p.id}`} className="hover:underline">
              {p.name}
            </Link>
          </TableCell>
          {templates.map((t) => {
            const included = t.grantsAll || t.packIds.includes(p.id);
            return (
              <TableCell key={t.id} className="text-center">
                {t.grantsAll ? (
                  <span className="text-xs text-muted-foreground">All</span>
                ) : included ? (
                  <>
                    <Check className="mx-auto size-4 text-bb-forest" aria-hidden />
                    <span className="sr-only">Included</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground" aria-hidden>
                      —
                    </span>
                    <span className="sr-only">Not included</span>
                  </>
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}

function TemplatesTab({
  templates,
  counts,
  permCount,
}: {
  templates: TemplateView[];
  counts: UserCounts;
  permCount: Map<string, number>;
}) {
  const sources = templates.filter((t) => !t.grantsAll).map((t) => ({ id: t.id, name: t.name }));
  return (
    <section aria-labelledby="templates-tab-heading" className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="templates-tab-heading" className="text-base font-semibold">
            Templates
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Built-in templates can have their packs changed (except Owner) but can&apos;t be
            deleted. Custom templates start as a copy of another.
          </p>
        </div>
        <NewTemplateDialog sources={sources} takenKeys={templates.map((t) => t.key)} />
      </div>
      <Table aria-label="Role templates">
        <TableHeader>
          <TableRow>
            <TableHead>Template</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Users</TableHead>
            <TableHead className="text-right">Packs</TableHead>
            <TableHead className="text-right">Permissions</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((t) => {
            const users = userCountLabel(counts, t.id);
            return (
              <TableRow key={t.id}>
                <TableCell className="min-w-48">
                  <Link
                    href={`/admin/roles/templates/${t.id}`}
                    className="font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{t.key}</span>
                </TableCell>
                <TableCell>
                  <TemplateBadges template={t} />
                </TableCell>
                <TableCell className="text-right">
                  {users.active}
                  {users.extra && (
                    <span className="block text-xs text-muted-foreground">{users.extra}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{t.grantsAll ? "—" : t.packIds.length}</TableCell>
                <TableCell className="text-right">
                  {t.grantsAll ? "All" : (permCount.get(t.id) ?? 0)}
                </TableCell>
                <TableCell className="text-right">
                  {!t.isSystem && (
                    <DeleteRecordDialog table="role_templates" id={t.id} name={t.name} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function PacksTab({ packs, templates }: { packs: PackView[]; templates: TemplateView[] }) {
  const usedBy = (packId: string) => templates.filter((t) => t.packIds.includes(packId)).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Packs</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Built-in packs are read-only. To change one, duplicate it as a custom pack and use that
            in a template.
          </p>
        </div>
        <Button asChild variant="cta">
          <Link href="/admin/roles/packs/new">
            <Plus aria-hidden /> New pack
          </Link>
        </Button>
      </div>
      {groupPacks(packs).map((g) => (
        <section
          key={g.category}
          aria-labelledby={`packs-${g.category}`}
          className="rounded-2xl border bg-card p-5"
        >
          <h3
            id={`packs-${g.category}`}
            className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {g.label}
          </h3>
          <ul className="divide-y">
            {g.packs.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/roles/packs/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <PackBadge pack={p} />
                  </div>
                  {p.description && (
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-4 text-sm text-muted-foreground">
                  <span>{plural(p.permissions.length, "permission")}</span>
                  <span>in {plural(usedBy(p.id), "template")}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UsersTab({
  page,
  data,
  templates,
}: {
  page: number;
  data: Awaited<ReturnType<typeof loadUsersPage>>;
  templates: TemplateView[];
}) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const pages = Math.max(1, Math.ceil(data.total / USERS_PAGE_SIZE));
  return (
    <section aria-labelledby="users-tab-heading" className="rounded-2xl border bg-card p-5">
      <h2 id="users-tab-heading" className="text-base font-semibold">
        Users
      </h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">
        Change someone&apos;s template or give them single-permission grants and revokes on their
        user page.
      </p>
      <Table aria-label="Users and their templates">
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Overrides</TableHead>
            <TableHead>
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.users.map((u) => {
            const t = byId.get(u.templateId);
            return (
              <TableRow key={u.id}>
                <TableCell className="min-w-48">
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{u.email}</span>
                </TableCell>
                <TableCell>
                  {t ? (
                    <Link href={`/admin/roles/templates/${t.id}`} className="hover:underline">
                      {t.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Deleted template</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={u.active ? "success" : "neutral"}>
                    {u.active ? "Active" : "Deactivated"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {u.overrides > 0 ? plural(u.overrides, "override") : "None"}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/admin/users/${u.id}`} aria-label={`Open ${u.name}`}>
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {pages > 1 && (
        <nav aria-label="Users pages" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {plural(data.total, "user")}
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/roles?tab=users&page=${page - 1}`}>Previous</Link>
              </Button>
            )}
            {page < pages && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/roles?tab=users&page=${page + 1}`}>Next</Link>
              </Button>
            )}
          </span>
        </nav>
      )}
    </section>
  );
}
