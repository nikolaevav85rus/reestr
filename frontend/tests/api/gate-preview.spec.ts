import { expect, request, test, type APIRequestContext } from '@playwright/test';
import {
  createDraft,
  expectForbidden,
  getJson,
  loginApi,
  marker,
  patchJson,
  postJson,
  USERS,
  type AuthSession,
} from '../helpers/api';
import { loadReferenceData, makeRequestPayload, requireScenario, type ReferenceData } from '../helpers/gate-fixtures';

test.describe('API regression: gate preview and workflow', () => {
  let api: APIRequestContext;
  let admin: AuthSession;
  let initiator: AuthSession;
  let feo: AuthSession;
  let cashier: AuthSession;
  let accountant: AuthSession;
  let director: AuthSession;
  let referenceData: ReferenceData;

  test.beforeAll(async () => {
    api = await request.newContext();
    admin = await loginApi(api, USERS.admin);
    initiator = await loginApi(api, USERS.initiator);
    feo = await loginApi(api, USERS.feo);
    cashier = await loginApi(api, USERS.cashier);
    accountant = await loginApi(api, USERS.accountant);
    director = await loginApi(api, USERS.director);
    referenceData = await loadReferenceData(api, admin);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('gate_preview covers payment, non-payment, holiday, salary day data when present', async () => {
    const dayTypes = new Set(referenceData.scenarios.map((scenario) => scenario.dayType));
    expect(dayTypes.has('PAYMENT')).toBeTruthy();

    for (const dayType of ['NON_PAYMENT', 'HOLIDAY', 'SALARY_DAY']) {
      test.info().annotations.push({
        type: dayTypes.has(dayType) ? 'covered' : 'not-present',
        description: dayType,
      });
    }
  });

  test('excel export permission is present and assigned to cashier and FEO', async () => {
    const permissions = await getJson<any[]>(api, admin, '/dict/permissions');
    expect(permissions.some((permission) => permission.name === 'req_export_excel')).toBeTruthy();
    expect(permissions.some((permission) => permission.name === 'cashier_workspace_view')).toBeTruthy();
    expect(cashier.permissions).toContain('req_export_excel');
    expect(cashier.permissions).toContain('cashier_workspace_view');
    expect(feo.permissions).toContain('req_export_excel');
    expect(feo.permissions).toContain('cashier_workspace_view');
    expect(initiator.permissions).not.toContain('req_export_excel');
    expect(initiator.permissions).not.toContain('cashier_workspace_view');
  });

  test('gate_preview respects calendar day type and DDS matrix', async () => {
    test.skip(referenceData.scenarios.length < 2, 'Not enough calendar/dictionary data to validate matrix behavior.');

    for (const scenario of referenceData.scenarios) {
      const preview = await postJson<any>(api, initiator, '/requests/gate_preview', {
        organization_id: scenario.organization.id,
        budget_item_id: scenario.budgetItem.id,
        payment_date: scenario.date,
      });

      expect(preview.allowed, scenario.name).toBe(scenario.expectedAllowed);
      if (scenario.expectedAllowed) {
        expect(preview.reasons ?? []).toHaveLength(0);
      } else {
        expect(preview.reason, scenario.name).toBeTruthy();
        expect(preview.reasons.length, scenario.name).toBeGreaterThan(0);
      }
    }
  });

  test('submit produces the same route as gate_preview', async () => {
    const allowedScenario = requireScenario(referenceData, (scenario) => scenario.expectedAllowed, 'allowed submit');
    const blockedScenario = requireScenario(referenceData, (scenario) => !scenario.expectedAllowed, 'blocked submit');

    for (const scenario of [allowedScenario, blockedScenario]) {
      const testMarker = marker('REG-P0-SUBMIT');
      const draft = await createDraft(api, initiator, makeRequestPayload(scenario, testMarker));
      const submitted = await postJson<any>(api, initiator, `/requests/${draft.id}/submit`);

      expect(submitted.approval_status, scenario.name).toBe(
        scenario.expectedAllowed ? 'PENDING' : 'PENDING_GATE',
      );
      expect(Boolean(submitted.gate_reason), scenario.name).toBe(!scenario.expectedAllowed);
    }
  });

  test('exception approval, rejection, and standard approval routes remain consistent', async () => {
    const blockedScenario = requireScenario(referenceData, (scenario) => !scenario.expectedAllowed, 'blocked exception');
    const allowedScenario = requireScenario(referenceData, (scenario) => scenario.expectedAllowed, 'allowed workflow');

    const approveExceptionMarker = marker('REG-P0-GATE-APPROVE');
    const approveExceptionDraft = await createDraft(
      api,
      initiator,
      makeRequestPayload(blockedScenario, approveExceptionMarker, 3456.78),
    );
    const gatePending = await postJson<any>(api, initiator, `/requests/${approveExceptionDraft.id}/submit`);
    expect(gatePending.approval_status).toBe('PENDING_GATE');

    const gateApproved = await postJson<any>(api, feo, `/requests/${approveExceptionDraft.id}/approve_gate`, {
      reason: `${approveExceptionMarker} exception approved`,
    });
    expect(gateApproved.approval_status).toBe('PENDING');
    expect(gateApproved.special_order).toBeTruthy();

    const gateRejectMarker = marker('REG-P0-GATE-REJECT');
    const gateRejectDraft = await createDraft(
      api,
      initiator,
      makeRequestPayload(blockedScenario, gateRejectMarker, 3457.89),
    );
    await postJson(api, initiator, `/requests/${gateRejectDraft.id}/submit`);
    const gateRejected = await postJson<any>(api, feo, `/requests/${gateRejectDraft.id}/reject_gate`, {
      reason: `${gateRejectMarker} exception rejected`,
    });
    expect(gateRejected.approval_status).toBe('REJECTED');

    const standardMarker = marker('REG-P0-STANDARD');
    const standardDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario, standardMarker, 4567.89));
    const pending = await postJson<any>(api, initiator, `/requests/${standardDraft.id}/submit`);
    expect(pending.approval_status).toBe('PENDING');

    const approved = await postJson<any>(api, feo, `/requests/${standardDraft.id}/approve`);
    expect(approved.approval_status).toBe('APPROVED');

    const paid = await postJson<any>(api, cashier, `/requests/${standardDraft.id}/pay`);
    expect(paid.payment_status).toBe('PAID');
  });

  test('clarification, postpone, memo, contract, and suspend paths are covered', async () => {
    const allowedScenario = requireScenario(referenceData, (scenario) => scenario.expectedAllowed, 'allowed workflow');

    const clarifyMarker = marker('REG-P0-CLARIFY');
    const clarifyDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario, clarifyMarker, 5001));
    await postJson(api, initiator, `/requests/${clarifyDraft.id}/submit`);
    const clarification = await postJson<any>(api, feo, `/requests/${clarifyDraft.id}/clarify`, {
      reason: `${clarifyMarker} needs details`,
    });
    expect(clarification.approval_status).toBe('CLARIFICATION');
    const resubmitted = await postJson<any>(api, initiator, `/requests/${clarifyDraft.id}/submit`);
    expect(resubmitted.approval_status).toBe('PENDING');

    const postponeMarker = marker('REG-P0-POSTPONE');
    const postponeDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario, postponeMarker, 5002));
    await postJson(api, initiator, `/requests/${postponeDraft.id}/submit`);
    const postponed = await postJson<any>(api, feo, `/requests/${postponeDraft.id}/postpone`, {
      reason: `${postponeMarker} reschedule`,
      payment_date: allowedScenario.date,
    });
    expect(postponed.approval_status).toBe('POSTPONED');
    const movedToDraft = await postJson<any>(api, initiator, `/requests/${postponeDraft.id}/move_to_draft`, {
      payment_date: allowedScenario.date,
    });
    expect(movedToDraft.approval_status).toBe('DRAFT');

    const memoApproveMarker = marker('REG-P0-MEMO-APPROVE');
    const memoApproveDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario, memoApproveMarker, 5003));
    await postJson(api, initiator, `/requests/${memoApproveDraft.id}/submit`);
    const pendingMemo = await patchJson<any>(api, feo, `/requests/${memoApproveDraft.id}/budget`, { is_budgeted: false });
    expect(pendingMemo.approval_status).toBe('PENDING_MEMO');
    const memoApproved = await postJson<any>(api, director, `/requests/${memoApproveDraft.id}/approve_memo`);
    expect(memoApproved.approval_status).toBe('PENDING');

    const memoRejectMarker = marker('REG-P0-MEMO-REJECT');
    const memoRejectDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario, memoRejectMarker, 5004));
    await postJson(api, initiator, `/requests/${memoRejectDraft.id}/submit`);
    await patchJson(api, feo, `/requests/${memoRejectDraft.id}/budget`, { is_budgeted: false });
    const memoRejected = await postJson<any>(api, director, `/requests/${memoRejectDraft.id}/reject_memo`, {
      reason: `${memoRejectMarker} rejected`,
    });
    expect(memoRejected.approval_status).toBe('REJECTED');

    const contractRequest = await patchJson<any>(api, accountant, `/requests/${memoApproveDraft.id}/contract`, {
      contract_status: true,
    });
    expect(contractRequest.contract_status).toBe(true);
    await expectForbidden(api, initiator, 'patch', `/requests/${memoApproveDraft.id}/contract`, {
      contract_status: false,
    });

    const suspendMarker = marker('REG-P0-SUSPEND');
    const suspendDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario, suspendMarker, 5005));
    await postJson(api, initiator, `/requests/${suspendDraft.id}/submit`);
    await postJson(api, feo, `/requests/${suspendDraft.id}/approve`);
    await expectForbidden(api, cashier, 'post', `/requests/${suspendDraft.id}/suspend`, {
      reason: `${suspendMarker} cashier must not suspend`,
    });
    const suspended = await postJson<any>(api, feo, `/requests/${suspendDraft.id}/suspend`, {
      reason: `${suspendMarker} delayed`,
    });
    expect(suspended.approval_status).toBe('SUSPENDED');
    const unsuspended = await postJson<any>(api, feo, `/requests/${suspendDraft.id}/unsuspend`, {
      payment_date: allowedScenario.date,
    });
    expect(unsuspended.approval_status).toBe('PENDING');
  });
});
