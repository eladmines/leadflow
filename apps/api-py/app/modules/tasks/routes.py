"""Follow-up tasks (F10), inside the tenant scope."""

from typing import Annotated

from fastapi import Query, Response

from app.deps import Db, Tenant, require_permission, tenant_router
from app.modules.tasks import schemas as s
from app.modules.tasks.service import TaskService

tenant = tenant_router()
VIEW = [require_permission("tasks.view")]


@tenant.get("/tasks", response_model=s.TaskListResponse, dependencies=VIEW)
async def list_tasks(ctx: Tenant, db: Db, q: Annotated[s.TaskListQuery, Query()]):
    return {"tasks": await TaskService(db).list_tasks(ctx, q)}


@tenant.post("/tasks", status_code=201, response_model=s.TaskResponse, dependencies=VIEW)
async def create_task(body: s.CreateTaskRequest, ctx: Tenant, db: Db):
    return {"task": await TaskService(db).create(ctx, body)}


@tenant.patch("/tasks/{task_id}", response_model=s.TaskResponse, dependencies=VIEW)
async def update_task(task_id: str, body: s.UpdateTaskRequest, ctx: Tenant, db: Db):
    return {"task": await TaskService(db).update(ctx, task_id, body)}


@tenant.delete("/tasks/{task_id}", status_code=204, dependencies=VIEW)
async def delete_task(task_id: str, ctx: Tenant, db: Db):
    await TaskService(db).remove(ctx, task_id)
    return Response(status_code=204)
