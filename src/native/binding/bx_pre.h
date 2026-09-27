// bx_pre.h: included BEFORE the Bend-emitted C in a generated wrapper TU
// (scripts/native-bridge/binding-build.mjs). It never edits the emitted file;
// it only redirects a handful of process-level calls by macro so that the
// runtime can live inside a Node process:
//   _exit                -> bx_exit       (fail-stop becomes a JS exception on the JS thread)
//   sigaction            -> bx_sigaction  (SIGSEGV/SIGBUS are chained, not stolen from V8)
//   mprotect             -> bx_mprotect   (records the runtime's stack guard pages)
//   fprintf / fwrite     -> bx_fprintf / bx_fwrite (stderr text is captured for the exception)
//   _NSGetExecutablePath -> bx_exec_path  (Metal archive lives next to the .node, not node)
//   main                 -> bend_cli_main (the CLI entry stays compiled but unused)
#ifndef BX_PRE_H
#define BX_PRE_H

#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <pthread.h>
#include <unistd.h>
#include <signal.h>
#include <sys/mman.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <time.h>
#include <sys/time.h>
#include <sys/resource.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

#define BX_WRAPPER 1

static void bx_exit(int code) __attribute__((noreturn));
static int  bx_sigaction(int sig, const struct sigaction* sa, struct sigaction* old);
static int  bx_mprotect(void* p, size_t n, int prot);
static int  bx_fprintf(FILE* f, const char* fmt, ...) __attribute__((format(printf, 2, 3)));
static size_t bx_fwrite(const void* p, size_t size, size_t n, FILE* f);
static int  bx_exec_path(char* buf, uint32_t* size);

#define _exit(c)                 bx_exit(c)
#define sigaction(s, a, o)       bx_sigaction(s, a, o)
#define mprotect(p, n, f)        bx_mprotect(p, n, f)
#define fprintf                  bx_fprintf
#define fwrite(p, s, n, f)       bx_fwrite(p, s, n, f)
#define _NSGetExecutablePath(b, n) bx_exec_path(b, n)
#define main                     bend_cli_main

#endif
