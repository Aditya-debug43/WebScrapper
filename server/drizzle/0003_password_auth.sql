-- Phase 4: email + password authentication.
--
-- OTP stops being a login mechanism and becomes two specific things:
-- verifying an address at signup, and authorising a password reset. The
-- purpose check is widened to those two values and the old 'login' value is
-- removed, so any outstanding legacy challenge must go first or the new
-- constraint cannot be added. These rows are one-time codes with a ten-minute
-- lifetime, so deleting them costs a user at most one resend.
DELETE FROM "otp_challenges" WHERE "purpose" = 'login';
--> statement-breakpoint
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_purpose_known";--> statement-breakpoint
ALTER TABLE "otp_challenges" ALTER COLUMN "purpose" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "reset_token_hash" text;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "reset_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
CREATE INDEX "otp_reset_token_idx" ON "otp_challenges" USING btree ("reset_token_hash");--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_purpose_known" CHECK ("otp_challenges"."purpose" in ('email_verification', 'password_reset'));