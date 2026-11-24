"""Response models whose contract matches the web app's TypeScript types.

`Wire` models leave out an optional field (default `None`) when it has no value, like the Zod
`.optional()` the Node API used, and describe it in the OpenAPI schema as optional-not-null, so the
types generated for the web app match what is actually sent.
"""

from typing import Any

from pydantic import BaseModel, model_serializer


def _optional_not_null(schema: dict[str, Any], cls: type[BaseModel]) -> None:
    for name, field in cls.model_fields.items():
        if field.is_required() or field.default is not None:
            continue
        prop = schema.get("properties", {}).get(field.alias or name)
        any_of = prop.get("anyOf") if prop else None
        if not any_of:
            continue
        rest = [x for x in any_of if x != {"type": "null"}]
        if len(rest) == 1:
            prop.pop("anyOf")
            prop.update(rest[0])
        else:
            prop["anyOf"] = rest


class Wire(BaseModel):
    model_config = {"json_schema_extra": _optional_not_null}

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema: Any, handler: Any) -> Any:
        # Describe the fields, not the opaque custom serializer below.
        return handler({k: v for k, v in core_schema.items() if k != "serialization"})

    @model_serializer(mode="wrap")
    def _omit_empty_optionals(self, handler: Any) -> Any:
        data = handler(self)
        for name, field in type(self).model_fields.items():
            key = field.serialization_alias or field.alias or name
            if not field.is_required() and field.default is None and data.get(key) is None:
                data.pop(key, None)
        return data
