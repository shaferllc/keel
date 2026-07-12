/** Public framework surface. Userland imports everything from "@keel/core". */

export { Container } from "./container.js";
export type { Token, Constructor, Factory } from "./container.js";
export { Application } from "./application.js";
export type { BootOptions, LifecycleHook, Configurator } from "./application.js";
export { Config, env } from "./config.js";
export { defineEnv, envVar, EnvValidationError } from "./env.js";
export type { EnvRule, EnvSchema, EnvValues, EnvType, DefineEnvOptions } from "./env.js";
export {
  app,
  config,
  view,
  bind,
  singleton,
  instance,
  make,
  bound,
  alias,
  swap,
  restore,
  events,
  emit,
  listen,
  cache,
  logger,
  onReady,
  onShutdown,
  terminate,
} from "./helpers.js";
export { Logger } from "./logger.js";
export { consoleSink, MemorySink, setLogger, namedLogger, tapLogs } from "./logger.js";
export type { LogLevel, LoggerOptions, LogRecord, Sink, RedactOptions } from "./logger.js";
export { requestLogger, requestLog } from "./request-logger.js";
export type { RequestLoggerOptions } from "./request-logger.js";
export { Events, EventBuffer } from "./events.js";
export type {
  Listener,
  AnyListener,
  ErrorHandler,
  EventsList,
  EventName,
  PayloadOf,
  RecordedEvent,
} from "./events.js";
export { Cache, MemoryStore } from "./cache.js";
export type { CacheStore, RememberOptions, PutOptions } from "./cache.js";
export { serveStatic } from "./static.js";
export type { StaticOptions } from "./static.js";
export {
  i18n,
  t,
  getI18n,
  setI18n,
  setTranslations,
  objectLoader,
  detectLocale,
  negotiateLocale,
  formatMessage,
  I18n,
  I18nManager,
} from "./i18n.js";
export type {
  Translations,
  TranslationsByLocale,
  TranslationLoader,
  I18nOptions,
  DetectLocaleOptions,
} from "./i18n.js";
export {
  lock,
  restoreLock,
  setLockStore,
  getLockStore,
  Lock,
  MemoryLockStore,
  LockNotHeldError,
} from "./lock.js";
export type { LockStore, AcquireOptions } from "./lock.js";
export {
  health,
  healthCheck,
  check,
  Result,
  BaseCheck,
  HealthChecks,
  DatabaseCheck,
  RedisCheck,
  CacheCheck,
} from "./health.js";
export type {
  HealthStatus,
  HealthReport,
  CheckReport,
  HealthCheckOptions,
} from "./health.js";
export {
  Storage,
  FakeStorage,
  MemoryDisk,
  storage,
  setDisk,
  fakeDisk,
  restoreDisk,
  serveStorage,
  signStorageUrl,
  verifyStorageUrl,
  contentTypeFor,
} from "./storage.js";
export type {
  Disk,
  Contents,
  FileVisibility,
  WriteOptions,
  FileMetadata,
  SignedFileOptions,
  SignedUploadOptions,
  ServeStorageOptions,
} from "./storage.js";
export { dump, dd } from "./debug.js";
export { hash, encryption, jwt } from "./crypto.js";
export type { JwtPayload, JwtSignOptions, JwtVerifyOptions, EncryptOptions } from "./crypto.js";
export { rateLimiter } from "./rate-limit.js";
export type { RateLimiterOptions } from "./rate-limit.js";
export { cors } from "./cors.js";
export type { CorsOptions } from "./cors.js";
export { securityHeaders } from "./shield.js";
export type { SecurityHeadersOptions, HstsOptions } from "./shield.js";
export { csrf, csrfToken, csrfField } from "./csrf.js";
export type { CsrfOptions } from "./csrf.js";
export {
  db,
  connection,
  getConnection,
  setConnection,
  addConnection,
  setDefaultConnection,
  connectionNames,
  clearConnections,
  transaction,
  inTransaction,
  QueryBuilder,
} from "./database.js";
export type {
  Connection,
  TransactionConnection,
  TransactionHandle,
  ConnectionHandle,
  WriteResult,
  Row,
  Dialect,
  Operator,
  Paginated,
} from "./database.js";
export { Model } from "./model.js";
export type { GlobalScope } from "./model.js";
export { ModelQuery } from "./model-query.js";
export type { ModelEvent, ModelHook, ModelObserver } from "./model-events.js";
export type { CastType, Casts } from "./casts.js";
export {
  Relation,
  HasOne,
  HasMany,
  BelongsTo,
  BelongsToMany,
  MorphOne,
  MorphMany,
  MorphTo,
  registerMorphType,
} from "./relations.js";
export { Faker, Factory as ModelFactory, factory, Seeder, seed } from "./factory.js";
export type { Definition } from "./factory.js";
export {
  Mailer,
  FakeMailer,
  PendingMail,
  BaseMail,
  SendMailJob,
  ArrayTransport,
  LogTransport,
  fetchTransport,
  mail,
  mailer,
  send,
  sendLater,
  setMailer,
  getMailer,
  fakeMail,
  restoreMail,
} from "./mail.js";
export type {
  Message,
  Transport,
  MailerOptions,
  FetchTransportOptions,
  Attachment,
  RecordedMail,
} from "./mail.js";
export {
  Job,
  Queue,
  FakeQueue,
  SyncDriver,
  MemoryDriver,
  dispatch,
  work,
  setQueue,
  getQueue,
  fakeQueue,
  restoreQueue,
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  noBackoff,
} from "./queue.js";
export type {
  Dispatchable,
  JobOptions,
  JobContext,
  JobClass,
  QueueDriver,
  Drainable,
  QueuedJob,
  FailedJob,
  Backoff,
} from "./queue.js";
export { Scheduler, ScheduledTask, scheduler, setScheduler, schedule, cronMatches } from "./scheduler.js";
export {
  MemoryBroadcaster,
  broadcast,
  setBroadcaster,
  getBroadcaster,
  channelAuth,
  authorizeChannel,
  clearChannels,
} from "./broadcasting.js";
export type { Broadcaster, Subscriber, ChannelAuthorizer } from "./broadcasting.js";
export { Redis, MemoryRedis, redis, setRedis, redisStore } from "./redis.js";
export type { RedisConnection, SetOptions } from "./redis.js";
export {
  Notification,
  Notifier,
  MailChannel,
  DatabaseChannel,
  ArrayChannel,
  routeFor,
  notify,
  setNotifier,
  getNotifier,
} from "./notification.js";
export type { Notifiable, MailContent, Channel } from "./notification.js";
export {
  SchemaBuilder,
  Migrator,
  TableBuilder,
  AlterTableBuilder,
  ForeignKeyBuilder,
  Column,
} from "./migrations.js";
export type { Migration } from "./migrations.js";
export {
  ctx,
  json,
  text,
  html,
  redirect,
  param,
  query,
  header,
  body,
  request,
  response,
} from "./request.js";
export {
  decorateRequest,
  hasRequestDecorator,
  decorated,
  setRequestValue,
  clearRequestDecorators,
} from "./decorators.js";
export type { RequestResolver } from "./decorators.js";
export type { ConfigData } from "./config.js";
export { View } from "./view.js";
export type { Renderable, ViewConfig } from "./view.js";
export {
  TemplateEngine,
  escapeHtml,
  templates,
  setTemplateEngine,
  render,
} from "./template.js";
export type { Filter, RenderContext } from "./template.js";
export { ServiceProvider } from "./provider.js";
export type { ProviderClass } from "./provider.js";
export {
  PackageProvider,
  MigrationRegistry,
  CommandRegistry,
  PublishRegistry,
} from "./package.js";
export type {
  PackageCommand,
  PublishEntry,
  PackageRouteOptions,
  PackageAssetOptions,
  PackageMiddleware,
} from "./package.js";
export {
  instrument,
  runRequest,
  currentRequestId,
  newRequestId,
} from "./instrumentation.js";
export type {
  QueryEvent,
  RequestEvent,
  ExceptionEvent,
  JobEvent,
  CacheEvent,
  NotificationEvent,
  ScheduleEvent,
  InstrumentEvent,
} from "./instrumentation.js";
export { Router, Route, RouteGroup, RouteResource, matchers } from "./http/router.js";
export type {
  Ctx,
  RouteHandler,
  RouteDefinition,
  Method,
  Matcher,
  MiddlewareRef,
  UrlOptions,
  SignedUrlOptions,
} from "./http/router.js";
export { Inertia, inertia, inertiaPageAttr } from "./inertia.js";
export type { InertiaPage, InertiaOptions } from "./inertia.js";
export { HttpKernel } from "./http/kernel.js";
export { bindModel, bindRoute, boundModel, boundValue, hasBinding, clearBindings } from "./binding.js";
export type { BindingOptions, ModelClass } from "./binding.js";
export { defineCommand, arg, flag, ConsoleKernel, ConsoleError, parseArgv } from "./console.js";
export type {
  CommandDefinition,
  CommandContext,
  AnyCommand,
  ArgSpec,
  FlagSpec,
  ArgsSpec,
  FlagsSpec,
  ConsoleKernelOptions,
} from "./console.js";
export { createUi, stripAnsi } from "./console-ui.js";
export type { Ui, UiOptions, Colors, ColorName, Table, Tasks, TaskHandle } from "./console-ui.js";
export { createPrompt } from "./console-prompt.js";
export type { Prompt, PromptOptions, ChoiceOptions, Choice, Trap } from "./console-prompt.js";
export { startRepl } from "./repl.js";
export type { ReplHelper, ReplOptions } from "./repl.js";
export { pages, definePages, routePattern, routeName } from "./pages.js";
export type { PageProps, PageModule, PagesOptions, RegisteredPage, PageMiddleware } from "./pages.js";
export {
  TestClient,
  TestResponse,
  CommandResult,
  testClient,
  runCommand,
  resetState,
  freezeTime,
  timeTravel,
  restoreTime,
  timeIsFrozen,
  spy,
  spyOn,
  restoreSpies,
  truncate,
  assertDatabaseHas,
  assertDatabaseMissing,
  assertDatabaseCount,
  assertDatabaseEmpty,
} from "./testing.js";
export type { Spy } from "./testing.js";
export {
  Tracer,
  Span,
  MemoryExporter,
  otlpExporter,
  consoleExporter,
  telemetry,
  setTelemetry,
  trace,
  currentSpan,
  setAttributes,
  addEvent,
  traceIds,
  flushTelemetry,
  tracing,
  parseTraceparent,
  traceparent,
  injectTraceContext,
} from "./telemetry.js";
export type {
  SpanContext,
  SpanData,
  SpanEvent,
  SpanKind,
  SpanStatus,
  SpanOptions,
  SpanExporter,
  SpanAttributes,
  SpanAttributeValue,
  TracerOptions,
  TracingOptions,
  OtlpOptions,
} from "./telemetry.js";
export {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  PaymentRequiredException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  NotAcceptableException,
  RequestTimeoutException,
  ConflictException,
  LengthRequiredException,
  ValidationException,
  TooManyRequestsException,
  ServerErrorException,
  NotImplementedException,
  BadGatewayException,
  ServiceUnavailableException,
  createError,
  STATUS_TEXT,
} from "./exceptions.js";
export { validate, validateRequest, validated } from "./validation.js";
export type { Schema, RequestSchemas } from "./validation.js";
export { Session, session, sessionMiddleware } from "./session.js";
export type { SessionOptions } from "./session.js";
export { Auth, auth, authGuard, bearerAuth, basicAuth, tokenAuth, token, tokenCan, setUserProvider } from "./auth.js";
export type { UserProvider, BasicVerifier } from "./auth.js";
export {
  createToken,
  verifyToken,
  revokeToken,
  revokeTokens,
  listTokens,
  tokenAllows,
  tokenDenies,
  setTokensTable,
} from "./tokens.js";
export type { AccessToken, CreateTokenOptions, IssuedToken } from "./tokens.js";
export {
  social,
  github,
  google,
  discord,
  oauthDriver,
  oauthState,
  OAuthDriver,
  OAuthError,
  twitter,
  oauth1Driver,
  oauth1Signature,
  OAuth1Driver,
} from "./social.js";
export type {
  SocialUser,
  OAuthToken,
  OAuthConfig,
  ProviderSpec,
  RedirectOptions,
  OAuth1Config,
  OAuth1Token,
  OAuth1ProviderSpec,
} from "./social.js";
export {
  define,
  policy,
  gateBefore,
  gateAfter,
  setUserResolver,
  clearAuthorization,
  can,
  cannot,
  canFor,
  authorize,
  authorizeFor,
} from "./authorization.js";
export type { GateCallback, BeforeCallback, AfterCallback } from "./authorization.js";
export { Transformer } from "./transformer.js";
export type { Attributes, DocumentOptions } from "./transformer.js";
export {
  Broker,
  Service,
  LocalTransporter,
  ServiceNotFoundError,
  RequestTimeoutError,
  broker,
  setBroker,
} from "./broker.js";
export type {
  ServiceSchema,
  Context,
  ActionHandler,
  EventHandler,
  ActionDef,
  ActionSchema,
  ActionHooks,
  EventSchema,
  ServiceHooks,
  Visibility,
  EventType,
  BeforeHook,
  AfterHook,
  ErrorHook,
  Transporter,
  BrokerOptions,
  BrokerMiddleware,
  CallOptions,
  EmitOptions,
  MCallDefs,
  MCallOptions,
} from "./broker.js";
export { Vite, viteTags, viteAsset, viteReactRefresh } from "./vite.js";
export type {
  ViteOptions,
  Manifest,
  ManifestChunk,
  Attributes as ViteAttributes,
  AttrValue,
} from "./vite.js";
