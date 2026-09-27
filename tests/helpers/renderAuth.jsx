import { render } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import AccountMenu from "../../src/components/auth/AccountMenu";
import { RedirectIfAuthenticated, RequireAuth } from "../../src/components/auth/RouteGuards";
import { AuthProvider } from "../../src/state/AuthContext";
import { ThemeProvider } from "../../src/state/ThemeContext";
import SignIn from "../../src/pages/auth/SignIn";
import CreateAccount from "../../src/pages/auth/CreateAccount";
import VerifyEmail from "../../src/pages/auth/VerifyEmail";
import ForgotPassword from "../../src/pages/auth/ForgotPassword";
import ResetPassword from "../../src/pages/auth/ResetPassword";

/**
 * The real providers, the real guards, the real screens.
 *
 * Only the protected destination is a stand-in: the dashboard behind the
 * guard pulls the whole catalogue through the pricing engine, and mounting
 * it would make every one of these tests slow while proving nothing about
 * authentication. `App.test.jsx` mounts the actual application once to show
 * that the real route table is wired the same way.
 */
export function renderAuthApp({ route = "/sign-in" } = {}) {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route element={<RedirectIfAuthenticated />}>
              <Route path="/sign-in" element={<SignIn />} />
              <Route path="/create-account" element={<CreateAccount />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route path="/" element={<ProtectedDesk />} />
              <Route path="/catalogue" element={<ProtectedDesk name="Catalogue" />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

/**
 * The stand-in destination carries the REAL account menu — the same
 * component the masthead renders — so signing out in a test goes through
 * the shipped control rather than through a helper written for the test.
 */
function ProtectedDesk({ name = "Dashboard" }) {
  return (
    <div data-testid="desk">
      <AccountMenu />
      Pricing desk: {name}
    </div>
  );
}

export const TOKEN_KEY = "mulya.auth.token.v1";
