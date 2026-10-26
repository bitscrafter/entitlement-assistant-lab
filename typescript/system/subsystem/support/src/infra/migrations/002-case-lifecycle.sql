-- Case lifecycle (case-lifecycle D4, D7, D17): an authentication's kind and method, the summary's bounds,
-- and closed cases by subject.
ALTER TABLE support_case DROP CONSTRAINT support_case_contact_authentication_kind_check;
UPDATE support_case SET contact_authentication_kind = 'Knowledge'
  WHERE contact_authentication_kind = 'KnowledgeFactor';
UPDATE support_case SET contact_authentication_kind = 'Possession'
  WHERE contact_authentication_kind = 'OneTimeCode';

ALTER TABLE support_case
  ADD CONSTRAINT support_case_contact_authentication_kind_check
    CHECK (contact_authentication_kind IN ('Knowledge', 'Possession')),
  ADD COLUMN contact_authentication_method text,
  ADD CONSTRAINT support_case_contact_authentication_method_of_kind CHECK (
    contact_authentication_method IS NULL
    OR (contact_authentication_kind = 'Knowledge'
        AND contact_authentication_method IN ('SecurityQuestion', 'AccountDetails', 'SupportPasscode'))
    OR (contact_authentication_kind = 'Possession' AND contact_authentication_method = 'OneTimeCode')
  ),
  ADD CONSTRAINT support_case_contact_authentication_method_with_kind
    CHECK ((contact_authentication_method IS NULL) = (contact_authentication_kind IS NULL)),
  ADD CONSTRAINT support_case_summary_bounds
    CHECK (case_summary IS NULL OR char_length(case_summary) BETWEEN 1 AND 4000),
  ADD CONSTRAINT support_case_summary_when_closed CHECK (case_summary IS NULL OR closed_at IS NOT NULL);

CREATE INDEX support_case_closed_by_subject ON support_case (subject_account_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;
