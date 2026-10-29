-- A personal-email person whose college says SRM-AP is asked once after sign-in: "SRM-AP student or from outside?". 'outside' = never asked for academic or OD details.
ALTER TABLE users ADD COLUMN srm_answer text CHECK (srm_answer IN ('srm','outside'));
