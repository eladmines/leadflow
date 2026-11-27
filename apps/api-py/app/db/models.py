"""SQLAlchemy models, generated from the existing Postgres schema (Prisma's tables)."""

import datetime
import decimal
import enum
import uuid
from typing import Optional

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Double,
    Enum,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    PrimaryKeyConstraint,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class AppointmentStatus(str, enum.Enum):
    REQUESTED = "REQUESTED"
    CONFIRMED = "CONFIRMED"
    COMPLETED = "COMPLETED"
    NO_SHOW = "NO_SHOW"
    CANCELLED = "CANCELLED"


class AuthTokenType(str, enum.Enum):
    EMAIL_VERIFY = "EMAIL_VERIFY"
    PASSWORD_RESET = "PASSWORD_RESET"


class BusinessStatus(str, enum.Enum):
    ONBOARDING = "ONBOARDING"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"


class LeadSource(str, enum.Enum):
    WEBSITE_FORM = "website_form"
    MANUAL = "manual"
    WHATSAPP = "whatsapp"
    FACEBOOK = "facebook"
    EMAIL = "email"
    INSTAGRAM = "instagram"


class MembershipRole(str, enum.Enum):
    OWNER = "OWNER"
    MANAGER = "MANAGER"
    EMPLOYEE = "EMPLOYEE"


class MembershipStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class QuoteStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class SiteStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    SUSPENDED = "SUSPENDED"


class StageKind(str, enum.Enum):
    OPEN = "OPEN"
    WON = "WON"
    LOST = "LOST"


class TaskStatus(str, enum.Enum):
    OPEN = "OPEN"
    DONE = "DONE"


class UserStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    BLOCKED = "BLOCKED"


class WhatsAppDirection(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class WhatsAppNumberStatus(str, enum.Enum):
    UNCLASSIFIED = "UNCLASSIFIED"
    BUSINESS = "BUSINESS"
    PERSONAL = "PERSONAL"


class PrismaMigration(Base):
    __tablename__ = "_prisma_migrations"
    __table_args__ = (PrimaryKeyConstraint("id", name="_prisma_migrations_pkey"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    migration_name: Mapped[str] = mapped_column(String(255), nullable=False)
    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(True), nullable=False, server_default=text("now()")
    )
    applied_steps_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    finished_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(True))
    logs: Mapped[str | None] = mapped_column(Text)
    rolled_back_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(True))


class Business(Base):
    __tablename__ = "businesses"
    __table_args__ = (PrimaryKeyConstraint("id", name="businesses_pkey"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    industry: Mapped[str] = mapped_column(String(40), nullable=False)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=text("'Asia/Jerusalem'::character varying")
    )
    status: Mapped[BusinessStatus] = mapped_column(
        Enum(
            BusinessStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="BusinessStatus",
        ),
        nullable=False,
        server_default=text("'ONBOARDING'::\"BusinessStatus\""),
    )
    onboarding_step: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    whatsapp_bot_auto_confirm: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    whatsapp_bot_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    whatsapp_bot_hold_date: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    whatsapp_reply_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'auto_reply'::character varying")
    )
    language: Mapped[str] = mapped_column(
        String(2), nullable=False, server_default=text("'he'::character varying")
    )
    whatsapp_questions_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(200))
    service_areas: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text()), server_default=text("ARRAY[]::text[]")
    )
    opening_hours: Mapped[object | None] = mapped_column(JSONB)
    website_url: Mapped[str | None] = mapped_column(String(300))
    whatsapp_bot_texts: Mapped[object | None] = mapped_column(JSONB)
    whatsapp_bot_showcase: Mapped[object | None] = mapped_column(JSONB)
    whatsapp_bot_flow: Mapped[str | None] = mapped_column(String(20))
    whatsapp_active_status: Mapped[object | None] = mapped_column(JSONB)
    whatsapp_auto_reply_text: Mapped[str | None] = mapped_column(String(1000))
    whatsapp_statuses: Mapped[object | None] = mapped_column(JSONB)
    whatsapp_questions: Mapped[object | None] = mapped_column(JSONB)
    domain_check: Mapped[str | None] = mapped_column(String(12))
    domain_checked_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    domain_expires_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    domain_reminded_days: Mapped[int | None] = mapped_column(Integer)

    sites: Mapped[list["Site"]] = relationship("Site", back_populates="business")
    assets: Mapped[list["Asset"]] = relationship("Asset", back_populates="business")
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="business")
    channel_connections: Mapped[list["ChannelConnection"]] = relationship(
        "ChannelConnection", back_populates="business"
    )
    contacts: Mapped[list["Contact"]] = relationship("Contact", back_populates="business")
    event_counts: Mapped[list["EventCount"]] = relationship("EventCount", back_populates="business")
    invitations: Mapped[list["Invitation"]] = relationship("Invitation", back_populates="business")
    memberships: Mapped[list["Membership"]] = relationship("Membership", back_populates="business")
    notifications: Mapped[list["Notification"]] = relationship("Notification", back_populates="business")
    oauth_pending: Mapped[list["OauthPending"]] = relationship("OauthPending", back_populates="business")
    pipeline_stages: Mapped[list["PipelineStage"]] = relationship("PipelineStage", back_populates="business")
    services: Mapped[list["Service"]] = relationship("Service", back_populates="business")
    visit_counts: Mapped[list["VisitCount"]] = relationship("VisitCount", back_populates="business")
    leads: Mapped[list["Lead"]] = relationship("Lead", back_populates="business")
    lead_field_definitions: Mapped[list["LeadFieldDefinition"]] = relationship(
        "LeadFieldDefinition", back_populates="business"
    )
    whatsapp_numbers: Mapped[list["WhatsAppNumber"]] = relationship(
        "WhatsAppNumber", back_populates="business"
    )
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="business")
    quotes: Mapped[list["Quote"]] = relationship("Quote", back_populates="business")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="business")
    whatsapp_bot_sessions: Mapped[list["WhatsAppBotSession"]] = relationship(
        "WhatsAppBotSession", back_populates="business"
    )
    whatsapp_messages: Mapped[list["WhatsAppMessage"]] = relationship(
        "WhatsAppMessage", back_populates="business"
    )


class SiteVersion(Base):
    __tablename__ = "site_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="site_versions_created_by_id_fkey",
        ),
        ForeignKeyConstraint(
            ["site_id"],
            ["sites.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="site_versions_site_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="site_versions_pkey"),
        Index("site_versions_business_id_idx", "business_id"),
        Index("site_versions_site_id_number_key", "site_id", "number", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    site_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[object] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    page_html: Mapped[object] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    created_by: Mapped[Optional["User"]] = relationship("User", back_populates="site_versions")
    site: Mapped["Site"] = relationship("Site", foreign_keys=[site_id], back_populates="site_versions_site")
    sites_published_version: Mapped[list["Site"]] = relationship(
        "Site", foreign_keys="[Site.published_version_id]", back_populates="published_version"
    )


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="sites_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["published_version_id"],
            ["site_versions.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="sites_published_version_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="sites_pkey"),
        Index("sites_business_id_key", "business_id", unique=True),
        Index("sites_published_version_id_key", "published_version_id", unique=True),
        Index("sites_subdomain_key", "subdomain", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    template_key: Mapped[str] = mapped_column(String(30), nullable=False)
    theme: Mapped[object] = mapped_column(JSONB, nullable=False)
    seo: Mapped[object] = mapped_column(JSONB, nullable=False)
    sections: Mapped[object] = mapped_column(JSONB, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    status: Mapped[SiteStatus] = mapped_column(
        Enum(
            SiteStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="SiteStatus",
        ),
        nullable=False,
        server_default=text("'DRAFT'::\"SiteStatus\""),
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    pages: Mapped[object] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    subdomain: Mapped[str | None] = mapped_column(String(40))

    site_versions_site: Mapped[list["SiteVersion"]] = relationship(
        "SiteVersion", foreign_keys="[SiteVersion.site_id]", back_populates="site"
    )
    business: Mapped["Business"] = relationship("Business", back_populates="sites")
    published_version: Mapped[Optional["SiteVersion"]] = relationship(
        "SiteVersion", foreign_keys=[published_version_id], back_populates="sites_published_version"
    )
    form_submissions: Mapped[list["FormSubmission"]] = relationship("FormSubmission", back_populates="site")


class StoredObject(Base):
    __tablename__ = "stored_objects"
    __table_args__ = (PrimaryKeyConstraint("key", name="stored_objects_pkey"),)

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(60), nullable=False)
    body: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="users_pkey"),
        Index("users_email_key", "email", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        Enum(
            UserStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="UserStatus",
        ),
        nullable=False,
        server_default=text("'ACTIVE'::\"UserStatus\""),
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    email_verified_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    site_versions: Mapped[list["SiteVersion"]] = relationship("SiteVersion", back_populates="created_by")
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="actor_user")
    auth_tokens: Mapped[list["AuthToken"]] = relationship("AuthToken", back_populates="user")
    invitations: Mapped[list["Invitation"]] = relationship("Invitation", back_populates="invited_by")
    memberships: Mapped[list["Membership"]] = relationship("Membership", back_populates="user")
    notifications: Mapped[list["Notification"]] = relationship("Notification", back_populates="user")
    sessions: Mapped[list["Session"]] = relationship("Session", back_populates="user")
    leads: Mapped[list["Lead"]] = relationship("Lead", back_populates="owner")
    whatsapp_numbers: Mapped[list["WhatsAppNumber"]] = relationship(
        "WhatsAppNumber", back_populates="classified_by"
    )
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="staff")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="assignee")
    whatsapp_messages: Mapped[list["WhatsAppMessage"]] = relationship(
        "WhatsAppMessage", back_populates="sender"
    )


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="assets_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="assets_pkey"),
        Index("assets_business_id_created_at_idx", "business_id", "created_at"),
        Index("assets_key_key", "key", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    mime: Mapped[str] = mapped_column(String(40), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    original_name: Mapped[str | None] = mapped_column(String(200))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    business: Mapped["Business"] = relationship("Business", back_populates="assets")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="audit_logs_actor_user_id_fkey",
        ),
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="audit_logs_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="audit_logs_pkey"),
        Index("audit_logs_actor_user_id_created_at_idx", "actor_user_id", "created_at"),
        Index("audit_logs_business_id_created_at_idx", "business_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    metadata_: Mapped[object] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    actor_user: Mapped[Optional["User"]] = relationship("User", back_populates="audit_logs")
    business: Mapped[Optional["Business"]] = relationship("Business", back_populates="audit_logs")


class AuthToken(Base):
    __tablename__ = "auth_tokens"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="auth_tokens_user_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="auth_tokens_pkey"),
        Index("auth_tokens_token_hash_key", "token_hash", unique=True),
        Index("auth_tokens_user_id_type_idx", "user_id", "type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    type: Mapped[AuthTokenType] = mapped_column(
        Enum(
            AuthTokenType,
            values_callable=lambda cls: [member.value for member in cls],
            name="AuthTokenType",
        ),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    used_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    user: Mapped["User"] = relationship("User", back_populates="auth_tokens")


class ChannelConnection(Base):
    __tablename__ = "channel_connections"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="channel_connections_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="channel_connections_pkey"),
        Index("channel_connections_business_id_channel_key", "business_id", "channel", unique=True),
        Index("channel_connections_channel_external_id_key", "channel", "external_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    connected_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    page_id: Mapped[str | None] = mapped_column(String(64))
    sync_cursor: Mapped[int | None] = mapped_column(BigInteger)

    business: Mapped["Business"] = relationship("Business", back_populates="channel_connections")


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="contacts_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="contacts_pkey"),
        Index("contacts_business_id_email_idx", "business_id", "email"),
        Index("contacts_business_id_phone_idx", "business_id", "phone"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(254))

    business: Mapped["Business"] = relationship("Business", back_populates="contacts")
    leads: Mapped[list["Lead"]] = relationship("Lead", back_populates="contact")
    whatsapp_numbers: Mapped[list["WhatsAppNumber"]] = relationship(
        "WhatsAppNumber", back_populates="contact"
    )
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="contact")
    whatsapp_messages: Mapped[list["WhatsAppMessage"]] = relationship(
        "WhatsAppMessage", back_populates="contact"
    )


class EventCount(Base):
    __tablename__ = "event_counts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="event_counts_business_id_fkey",
        ),
        PrimaryKeyConstraint("business_id", "day", "kind", "label", name="event_counts_pkey"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    kind: Mapped[str] = mapped_column(String(12), primary_key=True)
    label: Mapped[str] = mapped_column(
        String(100), primary_key=True, server_default=text("''::character varying")
    )
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    business: Mapped["Business"] = relationship("Business", back_populates="event_counts")


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="invitations_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["invited_by_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="invitations_invited_by_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="invitations_pkey"),
        Index("invitations_business_id_email_idx", "business_id", "email"),
        Index("invitations_token_hash_key", "token_hash", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    role: Mapped[MembershipRole] = mapped_column(
        Enum(
            MembershipRole,
            values_callable=lambda cls: [member.value for member in cls],
            name="MembershipRole",
        ),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    accepted_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    revoked_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    business: Mapped["Business"] = relationship("Business", back_populates="invitations")
    invited_by: Mapped[Optional["User"]] = relationship("User", back_populates="invitations")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="memberships_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="memberships_user_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="memberships_pkey"),
        Index("memberships_business_id_idx", "business_id"),
        Index("memberships_user_id_business_id_key", "user_id", "business_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    role: Mapped[MembershipRole] = mapped_column(
        Enum(
            MembershipRole,
            values_callable=lambda cls: [member.value for member in cls],
            name="MembershipRole",
        ),
        nullable=False,
    )
    status: Mapped[MembershipStatus] = mapped_column(
        Enum(
            MembershipStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="MembershipStatus",
        ),
        nullable=False,
        server_default=text("'ACTIVE'::\"MembershipStatus\""),
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    notify_new_leads: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    invited_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    business: Mapped["Business"] = relationship("Business", back_populates="memberships")
    user: Mapped["User"] = relationship("User", back_populates="memberships")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="notifications_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="notifications_user_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="notifications_pkey"),
        Index(
            "notifications_user_id_business_id_created_at_idx",
            "user_id",
            "business_id",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    data: Mapped[object] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    read_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    business: Mapped["Business"] = relationship("Business", back_populates="notifications")
    user: Mapped["User"] = relationship("User", back_populates="notifications")


class OauthPending(Base):
    __tablename__ = "oauth_pending"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="oauth_pending_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="oauth_pending_pkey"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    data_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )

    business: Mapped["Business"] = relationship("Business", back_populates="oauth_pending")


class PipelineStage(Base):
    __tablename__ = "pipeline_stages"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="pipeline_stages_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="pipeline_stages_pkey"),
        Index("pipeline_stages_business_id_position_key", "business_id", "position", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[StageKind] = mapped_column(
        Enum(
            StageKind,
            values_callable=lambda cls: [member.value for member in cls],
            name="StageKind",
        ),
        nullable=False,
        server_default=text("'OPEN'::\"StageKind\""),
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )

    business: Mapped["Business"] = relationship("Business", back_populates="pipeline_stages")
    leads: Mapped[list["Lead"]] = relationship("Lead", back_populates="stage")


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="services_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="services_pkey"),
        Index("services_business_id_active_idx", "business_id", "active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    price: Mapped[int | None] = mapped_column(Integer)

    business: Mapped["Business"] = relationship("Business", back_populates="services")
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="service")


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="sessions_user_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="sessions_pkey"),
        Index("sessions_token_hash_key", "token_hash", unique=True),
        Index("sessions_user_id_idx", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    token_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    absolute_expires_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    last_seen_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    revoked_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    user: Mapped["User"] = relationship("User", back_populates="sessions")


class VisitCount(Base):
    __tablename__ = "visit_counts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="visit_counts_business_id_fkey",
        ),
        PrimaryKeyConstraint("business_id", "day", "source", "name", "campaign", name="visit_counts_pkey"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    source: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(
        String(100), primary_key=True, server_default=text("''::character varying")
    )
    campaign: Mapped[str] = mapped_column(
        String(100), primary_key=True, server_default=text("''::character varying")
    )
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    business: Mapped["Business"] = relationship("Business", back_populates="visit_counts")


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="leads_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="leads_contact_id_fkey",
        ),
        ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="leads_owner_id_fkey",
        ),
        ForeignKeyConstraint(
            ["stage_id"],
            ["pipeline_stages.id"],
            ondelete="RESTRICT",
            onupdate="CASCADE",
            name="leads_stage_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="leads_pkey"),
        Index("leads_business_id_attribution_source_idx", "business_id", "attribution_source"),
        Index("leads_business_id_created_at_idx", "business_id", "created_at"),
        Index("leads_business_id_next_action_at_idx", "business_id", "next_action_at"),
        Index("leads_business_id_owner_id_idx", "business_id", "owner_id"),
        Index("leads_business_id_stage_id_idx", "business_id", "stage_id"),
        Index(
            "leads_custom_fields_idx",
            "custom_fields",
            postgresql_using="gin",
            postgresql_ops={"custom_fields": "jsonb_path_ops"},
        ),
        CheckConstraint("jsonb_typeof(custom_fields) = 'object'", name="leads_custom_fields_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    contact_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    stage_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    source: Mapped[LeadSource] = mapped_column(
        Enum(
            LeadSource,
            values_callable=lambda cls: [member.value for member in cls],
            name="LeadSource",
        ),
        nullable=False,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    source_url: Mapped[str | None] = mapped_column(String(300))
    message: Mapped[str | None] = mapped_column(String(1000))
    expected_value: Mapped[int | None] = mapped_column(Integer)
    next_action_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text()), server_default=text("ARRAY[]::text[]"))
    attribution: Mapped[object | None] = mapped_column(JSONB)
    attribution_source: Mapped[str | None] = mapped_column(String(20))
    # F34 (D-203): `{ "<lead_field_definitions.id>": value }`; empty values are removed, never null.
    # Personal data: never log it or put it on a trace attribute.
    custom_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    business: Mapped["Business"] = relationship("Business", back_populates="leads")
    contact: Mapped["Contact"] = relationship("Contact", back_populates="leads")
    owner: Mapped[Optional["User"]] = relationship("User", back_populates="leads")
    stage: Mapped["PipelineStage"] = relationship("PipelineStage", back_populates="leads")
    activities: Mapped[list["Activity"]] = relationship("Activity", back_populates="lead")
    appointments: Mapped[list["Appointment"]] = relationship("Appointment", back_populates="lead")
    form_submissions: Mapped[list["FormSubmission"]] = relationship("FormSubmission", back_populates="lead")
    quotes: Mapped[list["Quote"]] = relationship("Quote", back_populates="lead")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="lead")
    whatsapp_messages: Mapped[list["WhatsAppMessage"]] = relationship(
        "WhatsAppMessage", back_populates="lead"
    )


class LeadFieldDefinition(Base):
    """A business's own lead field (F34, D-203). Values live in `leads.custom_fields` under this
    id. The type never changes; archiving (`archived_at`) hides the field but keeps its values.
    `options` (select only): `[{"id", "label", "archived_at"?}]` in display order."""

    __tablename__ = "lead_field_definitions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="lead_field_definitions_business_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="lead_field_definitions_pkey"),
        CheckConstraint(
            "type IN ('text', 'number', 'date', 'select', 'boolean')",
            name="lead_field_definitions_type_check",
        ),
        CheckConstraint("jsonb_typeof(options) = 'array'", name="lead_field_definitions_options_check"),
        Index(
            "lead_field_definitions_business_id_archived_at_position_idx",
            "business_id",
            "archived_at",
            "position",
        ),
        Index(
            "lead_field_definitions_active_label_key",
            "business_id",
            text("lower(label)"),
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    options: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    number_min: Mapped[float | None] = mapped_column(Double)
    number_max: Mapped[float | None] = mapped_column(Double)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    archived_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))

    business: Mapped["Business"] = relationship("Business", back_populates="lead_field_definitions")


class WhatsAppNumber(Base):
    __tablename__ = "whatsapp_numbers"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="whatsapp_numbers_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["classified_by_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="whatsapp_numbers_classified_by_id_fkey",
        ),
        ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="whatsapp_numbers_contact_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="whatsapp_numbers_pkey"),
        Index("whatsapp_numbers_business_id_last_message_at_idx", "business_id", "last_message_at"),
        Index("whatsapp_numbers_business_id_phone_key", "business_id", "phone", unique=True),
        Index("whatsapp_numbers_business_id_status_idx", "business_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    phone: Mapped[str] = mapped_column(String(260), nullable=False)
    status: Mapped[WhatsAppNumberStatus] = mapped_column(
        Enum(
            WhatsAppNumberStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="WhatsAppNumberStatus",
        ),
        nullable=False,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    bot_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    channel: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'whatsapp'::character varying")
    )
    unread: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    profile_name: Mapped[str | None] = mapped_column(String(80))
    classified_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    classified_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    bot_showcase_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    auto_reply_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    last_message_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    attribution: Mapped[object | None] = mapped_column(JSONB)

    business: Mapped["Business"] = relationship("Business", back_populates="whatsapp_numbers")
    classified_by: Mapped[Optional["User"]] = relationship("User", back_populates="whatsapp_numbers")
    contact: Mapped[Optional["Contact"]] = relationship("Contact", back_populates="whatsapp_numbers")
    whatsapp_bot_sessions: Mapped[list["WhatsAppBotSession"]] = relationship(
        "WhatsAppBotSession", back_populates="number"
    )
    whatsapp_messages: Mapped[list["WhatsAppMessage"]] = relationship(
        "WhatsAppMessage", back_populates="number"
    )


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        ForeignKeyConstraint(
            ["lead_id"],
            ["leads.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="activities_lead_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="activities_pkey"),
        Index("activities_business_id_lead_id_created_at_idx", "business_id", "lead_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    lead_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    data: Mapped[object] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    lead: Mapped["Lead"] = relationship("Lead", back_populates="activities")


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="appointments_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="appointments_contact_id_fkey",
        ),
        ForeignKeyConstraint(
            ["lead_id"],
            ["leads.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="appointments_lead_id_fkey",
        ),
        ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="appointments_service_id_fkey",
        ),
        ForeignKeyConstraint(
            ["staff_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="appointments_staff_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="appointments_pkey"),
        Index("appointments_business_id_lead_id_idx", "business_id", "lead_id"),
        Index(
            "appointments_business_id_staff_id_starts_at_idx",
            "business_id",
            "staff_id",
            "starts_at",
        ),
        Index("appointments_business_id_starts_at_idx", "business_id", "starts_at"),
        Index("appointments_business_id_status_idx", "business_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    contact_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    starts_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    ends_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    status: Mapped[AppointmentStatus] = mapped_column(
        Enum(
            AppointmentStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="AppointmentStatus",
        ),
        nullable=False,
        server_default=text("'CONFIRMED'::\"AppointmentStatus\""),
    )
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'manual'::character varying")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    service_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    staff_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    notes: Mapped[str | None] = mapped_column(String(1000))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    business: Mapped["Business"] = relationship("Business", back_populates="appointments")
    contact: Mapped["Contact"] = relationship("Contact", back_populates="appointments")
    lead: Mapped[Optional["Lead"]] = relationship("Lead", back_populates="appointments")
    service: Mapped[Optional["Service"]] = relationship("Service", back_populates="appointments")
    staff: Mapped[Optional["User"]] = relationship("User", back_populates="appointments")


class FormSubmission(Base):
    __tablename__ = "form_submissions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["lead_id"],
            ["leads.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="form_submissions_lead_id_fkey",
        ),
        ForeignKeyConstraint(
            ["site_id"],
            ["sites.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="form_submissions_site_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="form_submissions_pkey"),
        Index("form_submissions_business_id_created_at_idx", "business_id", "created_at"),
        Index("form_submissions_lead_id_key", "lead_id", unique=True),
        Index(
            "form_submissions_site_id_idempotency_key_key",
            "site_id",
            "idempotency_key",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[object] = mapped_column(JSONB, nullable=False)
    consent_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    lead_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    lead: Mapped["Lead"] = relationship("Lead", back_populates="form_submissions")
    site: Mapped[Optional["Site"]] = relationship("Site", back_populates="form_submissions")


class Quote(Base):
    __tablename__ = "quotes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="quotes_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["lead_id"],
            ["leads.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="quotes_lead_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="quotes_pkey"),
        Index("quotes_business_id_lead_id_idx", "business_id", "lead_id"),
        Index("quotes_business_id_number_key", "business_id", "number", unique=True),
        Index("quotes_business_id_status_idx", "business_id", "status"),
        Index("quotes_public_token_key", "public_token", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    lead_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(
        String(120), nullable=False, server_default=text("''::character varying")
    )
    items: Mapped[object] = mapped_column(JSONB, nullable=False)
    discount: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    vat_rate: Mapped[decimal.Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, server_default=text("18")
    )
    notes: Mapped[str] = mapped_column(
        String(2000), nullable=False, server_default=text("''::character varying")
    )
    status: Mapped[QuoteStatus] = mapped_column(
        Enum(
            QuoteStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="QuoteStatus",
        ),
        nullable=False,
        server_default=text("'DRAFT'::\"QuoteStatus\""),
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    valid_until: Mapped[datetime.date | None] = mapped_column(Date)
    public_token: Mapped[str | None] = mapped_column(String(64))
    sent_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    decided_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    business: Mapped["Business"] = relationship("Business", back_populates="quotes")
    lead: Mapped["Lead"] = relationship("Lead", back_populates="quotes")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["assignee_id"],
            ["users.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="tasks_assignee_id_fkey",
        ),
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="tasks_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["lead_id"],
            ["leads.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="tasks_lead_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="tasks_pkey"),
        Index("tasks_business_id_assignee_id_status_idx", "business_id", "assignee_id", "status"),
        Index("tasks_business_id_lead_id_idx", "business_id", "lead_id"),
        Index("tasks_business_id_status_due_at_idx", "business_id", "status", "due_at"),
        Index(
            "tasks_status_remind_reminder_sent_at_due_at_idx",
            "status",
            "remind",
            "reminder_sent_at",
            "due_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(
            TaskStatus,
            values_callable=lambda cls: [member.value for member in cls],
            name="TaskStatus",
        ),
        nullable=False,
        server_default=text("'OPEN'::\"TaskStatus\""),
    )
    assignee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    remind: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(1000))
    completed_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    lead_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    reminder_sent_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    assignee: Mapped["User"] = relationship("User", back_populates="tasks")
    business: Mapped["Business"] = relationship("Business", back_populates="tasks")
    lead: Mapped[Optional["Lead"]] = relationship("Lead", back_populates="tasks")


class WhatsAppBotSession(Base):
    __tablename__ = "whatsapp_bot_sessions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="whatsapp_bot_sessions_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["number_id"],
            ["whatsapp_numbers.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="whatsapp_bot_sessions_number_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="whatsapp_bot_sessions_pkey"),
        Index("whatsapp_bot_sessions_business_id_idx", "business_id"),
        Index("whatsapp_bot_sessions_number_id_key", "number_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    number_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    step: Mapped[str] = mapped_column(String(20), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(TIMESTAMP(True, 3), nullable=False)
    service_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    date: Mapped[str | None] = mapped_column(String(10))
    time: Mapped[str | None] = mapped_column(String(5))
    data: Mapped[object | None] = mapped_column(JSONB)

    business: Mapped["Business"] = relationship("Business", back_populates="whatsapp_bot_sessions")
    number: Mapped["WhatsAppNumber"] = relationship("WhatsAppNumber", back_populates="whatsapp_bot_sessions")


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="whatsapp_messages_business_id_fkey",
        ),
        ForeignKeyConstraint(
            ["contact_id"],
            ["contacts.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="whatsapp_messages_contact_id_fkey",
        ),
        ForeignKeyConstraint(
            ["lead_id"],
            ["leads.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="whatsapp_messages_lead_id_fkey",
        ),
        ForeignKeyConstraint(
            ["number_id"],
            ["whatsapp_numbers.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="whatsapp_messages_number_id_fkey",
        ),
        ForeignKeyConstraint(
            ["sender_id"],
            ["users.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="whatsapp_messages_sender_id_fkey",
        ),
        PrimaryKeyConstraint("id", name="whatsapp_messages_pkey"),
        Index(
            "whatsapp_messages_business_id_contact_id_created_at_idx",
            "business_id",
            "contact_id",
            "created_at",
        ),
        Index("whatsapp_messages_number_id_created_at_idx", "number_id", "created_at"),
        Index("whatsapp_messages_wa_message_id_key", "wa_message_id", unique=True),
        Index(
            "whatsapp_messages_queued_idx",
            "number_id",
            "send_seq",
            postgresql_where=text("status = 'queued'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    direction: Mapped[WhatsAppDirection] = mapped_column(
        Enum(
            WhatsAppDirection,
            values_callable=lambda cls: [member.value for member in cls],
            name="WhatsAppDirection",
        ),
        nullable=False,
    )
    wa_message_id: Mapped[str] = mapped_column(String(128), nullable=False)
    body: Mapped[str] = mapped_column(String(4096), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    number_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    sender_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    subject: Mapped[str | None] = mapped_column(String(300))
    # D-202 phase 2: while `status` is "queued", what to send (cleared once sent or failed).
    send_payload: Mapped[dict | None] = mapped_column(JSONB)
    send_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    send_seq: Mapped[int | None] = mapped_column(BigInteger)  # nextval('whatsapp_messages_send_seq')

    business: Mapped["Business"] = relationship("Business", back_populates="whatsapp_messages")
    contact: Mapped[Optional["Contact"]] = relationship("Contact", back_populates="whatsapp_messages")
    lead: Mapped[Optional["Lead"]] = relationship("Lead", back_populates="whatsapp_messages")
    number: Mapped["WhatsAppNumber"] = relationship("WhatsAppNumber", back_populates="whatsapp_messages")
    sender: Mapped[Optional["User"]] = relationship("User", back_populates="whatsapp_messages")


class InboundEvent(Base):
    """A signed webhook delivery, stored before it is processed (D-202): the transactional outbox.

    Not tenant-owned yet: the business is decided while processing, from the receiving number or
    address, as before. Holds message text and phone numbers, so processed events are deleted after
    a few days (`app/modules/inbound/service.py`)."""

    __tablename__ = "inbound_events"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="inbound_events_pkey"),
        Index("inbound_events_dedupe_key_key", "dedupe_key", unique=True),
        Index(
            "inbound_events_unpublished_idx",
            "received_at",
            postgresql_where=text("published_at IS NULL AND processed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    received_at: Mapped[datetime.datetime] = mapped_column(
        TIMESTAMP(True, 3), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    published_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    processed_at: Mapped[datetime.datetime | None] = mapped_column(TIMESTAMP(True, 3))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_error: Mapped[str | None] = mapped_column(String(200))
    traceparent: Mapped[str | None] = mapped_column(String(64))  # W3C trace context of the webhook
