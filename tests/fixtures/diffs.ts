/** Small two-file diff: one modified source file, one added file. */
export const SIMPLE_DIFF = `diff --git a/src/services/auth.service.ts b/src/services/auth.service.ts
index 1111111..2222222 100644
--- a/src/services/auth.service.ts
+++ b/src/services/auth.service.ts
@@ -1,5 +1,9 @@
 export class AuthService {
-  login() {
-    return null;
+  login(email: string, password: string) {
+    return this.http.post('/login', { email, password });
+  }
+
+  refresh(token: string) {
+    return this.http.post('/refresh', { token });
   }
 }
diff --git a/src/utils/token-refresh.ts b/src/utils/token-refresh.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/utils/token-refresh.ts
@@ -0,0 +1,3 @@
+export function isExpired(token: string): boolean {
+  return decode(token).exp * 1000 < Date.now();
+}
`;

/** Diff touching three unrelated areas — the split command's happy path. */
export const MULTI_AREA_DIFF = `diff --git a/src/controllers/auth.controller.ts b/src/controllers/auth.controller.ts
index aaaaaaa..bbbbbbb 100644
--- a/src/controllers/auth.controller.ts
+++ b/src/controllers/auth.controller.ts
@@ -1,2 +1,4 @@
 export class AuthController {
+  @Post('login')
+  login(@Body() dto: LoginDto) { return this.service.login(dto); }
 }
diff --git a/src/components/stats-widget.tsx b/src/components/stats-widget.tsx
new file mode 100644
index 0000000..ccccccc
--- /dev/null
+++ b/src/components/stats-widget.tsx
@@ -0,0 +1,2 @@
+export const StatsWidget = () => <div>stats</div>;
+export default StatsWidget;
diff --git a/.eslintrc.json b/.eslintrc.json
index ddddddd..eeeeeee 100644
--- a/.eslintrc.json
+++ b/.eslintrc.json
@@ -1,3 +1,3 @@
 {
-  "extends": "eslint:recommended"
+  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"]
 }
`;

/** Contains a lockfile and a binary asset that must be filtered out. */
export const NOISY_DIFF = `diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
 {
-  "lockfileVersion": 2
+  "lockfileVersion": 3
 }
diff --git a/assets/logo.png b/assets/logo.png
index 4444444..5555555 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/src/index.ts b/src/index.ts
index 6666666..7777777 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1,2 @@
 console.log('hi');
+console.log('bye');
`;

export const RENAME_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 92%
rename from src/old-name.ts
rename to src/new-name.ts
index 1111111..2222222 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1 +1 @@
-export const name = 'old';
+export const name = 'new';
`;

export const DELETION_DIFF = `diff --git a/src/legacy.ts b/src/legacy.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/legacy.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const legacy = true;
-export default legacy;
`;

/** Builds a diff with `lines` added lines, for token-budget tests. */
export function bigDiff(lines: number, path = 'src/big.ts'): string {
  const body = Array.from({ length: lines }, (_, i) => `+const value${i} = ${i};`).join('\n');
  return `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -0,0 +1,${lines} @@
${body}
`;
}
