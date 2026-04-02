export type ProviderErrorKind = "retryable" | "non_retryable" | "user_fixable";

export type ProviderError = {
  kind: ProviderErrorKind;
  code: string;
  message: string;
};

export type ProviderContext = {
  sessionKey?: string;
  actorId?: string;
  correlationId?: string;
  authorizationScopes?: string[];
};

export type AppointmentSlot = {
  key: string;
  label: string;
  timezone: string;
};

export type BookingRequest = {
  slotLabel: string;
  patientRef?: string | null;
  visitType?: string | null;
};

export type BookingResult =
  | { ok: true; appointmentId: string; slotLabel: string }
  | { ok: false; error: ProviderError };

export type AppointmentChangeRequest =
  | { action: "cancel"; publicRef: string }
  | { action: "reschedule"; publicRef: string; newSlotLabel: string }
  | { action: "waitlist"; publicRef: string; whenHint: string; rawNotes?: string };

export type AppointmentChangeResult =
  | { ok: true; changeId: string; description: string }
  | { ok: false; error: ProviderError };

export type EligibilityRequest = {
  patientId?: string;
  payer?: string;
  memberId?: string;
};

export type EligibilityResult =
  | {
      ok: true;
      eligibilityId: string;
      status: string;
      payer: string;
      detail: string;
    }
  | { ok: false; error: ProviderError };

export type PatientMessageDraftRequest = {
  channel: "sms" | "email";
  purpose: string;
  who?: string;
  when?: string;
};

export type PatientMessageDraftResult =
  | {
      ok: true;
      draftId: string;
      channel: "sms" | "email";
      body: string;
    }
  | { ok: false; error: ProviderError };

export type CareNavigationResult =
  | { ok: true; routeId: string; team: string; rationale: string }
  | { ok: false; error: ProviderError };

export type TaskRoutingResult =
  | { ok: true; taskId: string; queue: string }
  | { ok: false; error: ProviderError };

export type IntakeBundle = {
  meds: string;
  allergies: string;
  pharmacy: string;
};

export type IntakeSubmitResult =
  | { ok: true; bundleId: string; ehrRef: string; note: string }
  | { ok: false; error: ProviderError };

export type IntegrationCapabilities = {
  booking: boolean;
  eligibility: boolean;
  patientDraft: boolean;
  careNavigation: boolean;
  taskRouting: boolean;
  intakeSubmit: boolean;
};

export interface CalendarProvider {
  listAvailability(ctx: ProviderContext): Promise<AppointmentSlot[]>;
  book(ctx: ProviderContext, req: BookingRequest): Promise<BookingResult>;
  change(ctx: ProviderContext, req: AppointmentChangeRequest): Promise<AppointmentChangeResult>;
}

export interface EligibilityProvider {
  checkEligibility(ctx: ProviderContext, req: EligibilityRequest): Promise<EligibilityResult>;
}

export interface PatientMessagingProvider {
  createDraft(
    ctx: ProviderContext,
    req: PatientMessageDraftRequest,
  ): Promise<PatientMessageDraftResult>;
}

export interface CareNavigationProvider {
  suggestTeam(ctx: ProviderContext, question: string): Promise<CareNavigationResult>;
}

export interface TaskRoutingProvider {
  routeTask(
    ctx: ProviderContext,
    req: { what?: string; who?: string; rawNotes?: string },
  ): Promise<TaskRoutingResult>;
}

export interface EhrProvider {
  submitIntake(ctx: ProviderContext, intake: IntakeBundle): Promise<IntakeSubmitResult>;
}

export interface IntegrationProvider
  extends CalendarProvider,
    EligibilityProvider,
    PatientMessagingProvider,
    CareNavigationProvider,
    TaskRoutingProvider,
    EhrProvider {
  readonly name: string;
  readonly capabilities: IntegrationCapabilities;
}
