/**
 * Compile-time contract check: what the Python API says it returns (`generated.ts`, from its
 * OpenAPI schema) must be usable where the web app expects the shared types. Never run; `tsc`
 * (pnpm typecheck) is the test. A failure here means the two sides disagree about a response.
 */
import type {
  AppointmentListResponse,
  AuthUser,
  BusinessListResponse,
  ChannelsResponse,
  ConversationListResponse,
  CustomerListResponse,
  LeadDetailResponse,
  LeadListResponse,
  NotificationListResponse,
  PipelineResponse,
  QuoteListResponse,
  ReportSummary,
  TaskListResponse,
  WhatsAppBotResponse,
  WhatsAppInboxResponse,
  WhatsAppThreadResponse,
} from '@simplecatch/shared';
import type { components } from './generated';

type S = components['schemas'];

/** `Wire<A, B>`: a value of the API's type A can be used as the web's type B. */
type Wire<Api extends Web, Web> = Api;

export type Contract = [
  Wire<S['LeadListResponse'], LeadListResponse>,
  Wire<S['LeadDetailResponse'], LeadDetailResponse>,
  Wire<S['PipelineResponse'], PipelineResponse>,
  Wire<S['TaskListResponse'], TaskListResponse>,
  Wire<S['AppointmentListResponse'], AppointmentListResponse>,
  Wire<S['QuoteListResponse'], QuoteListResponse>,
  Wire<S['CustomerListResponse'], CustomerListResponse>,
  Wire<S['NotificationListResponse'], NotificationListResponse>,
  Wire<S['ReportSummary'], ReportSummary>,
  Wire<S['BusinessListResponse'], BusinessListResponse>,
  Wire<S['AuthUser'], AuthUser>,
  Wire<S['ChannelsResponse'], ChannelsResponse>,
  Wire<S['ConversationListResponse'], ConversationListResponse>,
  Wire<S['ThreadResponse'], WhatsAppThreadResponse>,
  Wire<S['InboxResponse'], WhatsAppInboxResponse>,
  Wire<S['BotResponse'], WhatsAppBotResponse>,
];
