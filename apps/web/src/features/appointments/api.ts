import {
  apiPaths,
  type Appointment,
  type AppointmentListQuery,
  type AppointmentListResponse,
  type AppointmentResponse,
  type CreateAppointmentRequest,
  type ServiceListResponse,
  type UpdateAppointmentRequest,
  type UpsertServiceRequest,
} from '@leadflow/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const ap = apiPaths.appointments;
export const appointmentsKey = (businessId: string) =>
  ['businesses', businessId, 'appointments'] as const;
const servicesKey = (businessId: string) => ['businesses', businessId, 'services'] as const;

const qs = (q: AppointmentListQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
  return `?${p.toString()}`;
};

export function useAppointments(businessId: string, query: AppointmentListQuery, enabled = true) {
  return useQuery({
    queryKey: [...appointmentsKey(businessId), 'list', query],
    queryFn: () => apiFetch<AppointmentListResponse>(`${ap.list(businessId)}${qs(query)}`),
    select: (d) => d.appointments,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled,
  });
}

export function useAppointmentRequests(businessId: string) {
  return useQuery({
    queryKey: [...appointmentsKey(businessId), 'requests'],
    queryFn: () => apiFetch<AppointmentListResponse>(ap.requests(businessId)),
    select: (d) => d.appointments,
    refetchInterval: 60_000,
  });
}

export function useServices(businessId: string) {
  return useQuery({
    queryKey: servicesKey(businessId),
    queryFn: () => apiFetch<ServiceListResponse>(ap.services(businessId)),
    select: (d) => d.services,
  });
}

/** Appointment changes also show in lead history, so lead caches refresh too. */
function useAppointmentMutation<T, R>(businessId: string, fn: (vars: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentsKey(businessId) });
      void queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'leads'] });
    },
  });
}

const json = (method: string, body?: unknown) => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const useCreateAppointment = (businessId: string) =>
  useAppointmentMutation(businessId, (body: CreateAppointmentRequest) =>
    apiFetch<AppointmentResponse>(ap.list(businessId), json('POST', body)),
  );

export const useUpdateAppointment = (businessId: string) =>
  useAppointmentMutation(businessId, ({ id, ...body }: UpdateAppointmentRequest & { id: string }) =>
    apiFetch<AppointmentResponse>(ap.appointment(businessId, id), json('PATCH', body)),
  );

function useServiceMutation<T>(businessId: string, fn: (vars: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: servicesKey(businessId) }),
  });
}
export const useSaveService = (businessId: string) =>
  useServiceMutation(businessId, ({ id, ...body }: UpsertServiceRequest & { id?: string }) =>
    id
      ? apiFetch(ap.service(businessId, id), json('PUT', body))
      : apiFetch(ap.services(businessId), json('POST', body)),
  );
export const useDeleteService = (businessId: string) =>
  useServiceMutation(businessId, (id: string) =>
    apiFetch<void>(ap.service(businessId, id), { method: 'DELETE' }),
  );

// --------------------------------------------------------------- dates

/** Local midnight of the given day. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Sunday of the week (Israeli week). */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay());
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DD` for `<input type="date">`, in local time. */
export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** `HH:MM` for `<input type="time">`, in local time. */
export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Local date + time inputs → ISO (UTC). */
export const fromInputs = (date: string, time: string) => new Date(`${date}T${time}`).toISOString();

export const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });
export const dayFmt = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
export const shortDayFmt = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

export const minutesOf = (a: Appointment) =>
  Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000);
