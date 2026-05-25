export type RegistryActionKey =
  | 'submit'
  | 'approve-exception'
  | 'approve'
  | 'memo-reason'
  | 'approve-memo'
  | 'pay'
  | 'suspend'
  | 'unsuspend'
  | 'move-to-draft'
  | 'file'
  | 'edit'
  | 'copy'
  | 'mark-deletion'
  | 'reject'
  | 'clarify'
  | 'postpone'
  | 'suspend-pending'
  | 'postpone-approved'
  | 'reject-exception'
  | 'cancel-memo'
  | 'reject-memo';

export type RegistryPrimaryActionKey = Extract<
  RegistryActionKey,
  | 'submit'
  | 'approve-exception'
  | 'approve'
  | 'memo-reason'
  | 'approve-memo'
  | 'pay'
  | 'suspend'
  | 'unsuspend'
  | 'move-to-draft'
>;

export type RegistryActionDecisionRow = {
  creator_id?: string;
  approval_status?: string;
  payment_status?: string;
  file_path?: string | null;
};

export type RegistryActionDecisionPermissions = {
  canCreate: boolean;
  canEditAll: boolean;
  canApprove: boolean;
  canGateApprove: boolean;
  canMemoApprove: boolean;
  canPay: boolean;
  canSuspend: boolean;
  canMarkDeletion: boolean;
};

export type RegistryActionDecisionUser = {
  id?: string;
  isSuperadmin?: boolean;
};

export type RegistryActionDecisionFlags = {
  isOwner: boolean;
  isDraft: boolean;
  isApproved: boolean;
  isUnpaid: boolean;
  isMemoRequired: boolean;
  canResubmit: boolean;
  canMoveToDraft: boolean;
};

export type RegistryActionDecisionResult = {
  flags: RegistryActionDecisionFlags;
  primaryActionKey?: RegistryPrimaryActionKey;
  secondaryActionKeys: RegistryActionKey[];
};

const RESUBMIT_APPROVAL_STATUSES = ['DRAFT', 'CLARIFICATION', 'POSTPONED'] as const;

export function resolveRegistryActionDecision(
  row: RegistryActionDecisionRow,
  permissions: RegistryActionDecisionPermissions,
  user: RegistryActionDecisionUser,
): RegistryActionDecisionResult {
  const approvalStatus = row.approval_status ?? '';
  const paymentStatus = row.payment_status ?? '';

  const flags: RegistryActionDecisionFlags = {
    isOwner: row.creator_id === user.id || !!user.isSuperadmin,
    isDraft: approvalStatus === 'DRAFT',
    isApproved: approvalStatus === 'APPROVED',
    isUnpaid: paymentStatus === 'UNPAID',
    isMemoRequired: approvalStatus === 'MEMO_REQUIRED',
    canResubmit: false,
    canMoveToDraft: false,
  };

  flags.canResubmit = flags.isOwner && RESUBMIT_APPROVAL_STATUSES.includes(approvalStatus as typeof RESUBMIT_APPROVAL_STATUSES[number]);
  flags.canMoveToDraft = (flags.isOwner && permissions.canCreate) || permissions.canEditAll;

  const primaryActionKey: RegistryPrimaryActionKey | undefined =
    permissions.canCreate && flags.canResubmit
      ? 'submit'
      : permissions.canGateApprove && approvalStatus === 'PENDING_GATE'
      ? 'approve-exception'
      : permissions.canApprove && approvalStatus === 'PENDING'
      ? 'approve'
      : permissions.canCreate && flags.isOwner && flags.isMemoRequired
      ? 'memo-reason'
      : permissions.canMemoApprove && approvalStatus === 'PENDING_MEMO'
      ? 'approve-memo'
      : permissions.canPay && flags.isApproved && flags.isUnpaid
      ? 'pay'
      : permissions.canSuspend && flags.isApproved && flags.isUnpaid
      ? 'suspend'
      : permissions.canSuspend && approvalStatus === 'SUSPENDED'
      ? 'unsuspend'
      : flags.canMoveToDraft && (flags.isMemoRequired || approvalStatus === 'PENDING_MEMO' || approvalStatus === 'POSTPONED')
      ? 'move-to-draft'
      : undefined;

  const secondaryActionKeys: RegistryActionKey[] = [];

  if (row.file_path) {
    secondaryActionKeys.push('file');
  }
  if ((permissions.canCreate || permissions.canEditAll) && flags.isDraft && (flags.isOwner || permissions.canEditAll)) {
    secondaryActionKeys.push('edit');
  }
  if (permissions.canCreate) {
    secondaryActionKeys.push('copy');
  }
  if (permissions.canMarkDeletion && (permissions.canEditAll || (flags.isOwner && paymentStatus !== 'PAID'))) {
    secondaryActionKeys.push('mark-deletion');
  }
  if (permissions.canApprove && approvalStatus === 'PENDING') {
    secondaryActionKeys.push('reject', 'clarify', 'postpone');
    if (permissions.canSuspend) {
      secondaryActionKeys.push('suspend-pending');
    }
  }
  if (permissions.canApprove && flags.isApproved && flags.isUnpaid) {
    secondaryActionKeys.push('postpone-approved');
  }
  if (permissions.canGateApprove && approvalStatus === 'PENDING_GATE') {
    secondaryActionKeys.push('reject-exception');
  }
  if (flags.isMemoRequired) {
    if (permissions.canCreate && flags.isOwner && primaryActionKey !== 'memo-reason') {
      secondaryActionKeys.push('memo-reason');
    }
    if (permissions.canCreate && flags.isOwner) {
      secondaryActionKeys.push('cancel-memo');
    }
  }
  if (permissions.canMemoApprove && approvalStatus === 'PENDING_MEMO') {
    secondaryActionKeys.push('reject-memo');
  }
  if (permissions.canSuspend && flags.isApproved && flags.isUnpaid && primaryActionKey !== 'suspend') {
    secondaryActionKeys.push('suspend');
  }
  if (
    flags.canMoveToDraft &&
    (flags.isMemoRequired || approvalStatus === 'PENDING_MEMO' || approvalStatus === 'POSTPONED') &&
    primaryActionKey !== 'move-to-draft'
  ) {
    secondaryActionKeys.push('move-to-draft');
  }

  return {
    flags,
    primaryActionKey,
    secondaryActionKeys,
  };
}
