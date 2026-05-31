UPDATE public.guest_matches
SET confidence = GREATEST(0::real, LEAST(1::real, ((confidence - 0.4) / 0.3)::real));