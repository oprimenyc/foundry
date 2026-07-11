# PROVIDER_CAPABILITY_MATRIX.md

**Foundry Provider Capability Matrix — M2**
**Live source:** `GET /api/providers` → `capabilityMatrix` (runtime truth) or
`universalRegistry.capabilityMatrix()`. This file is a snapshot; the route is
the authority.

---

| Category | Provider | Actions | Runtime |
|---|---|---|---|
| hosting | vercel | create_project, trigger_deployment, verify_deployment | mock/live¹ |
| hosting | railway | create_project, trigger_deployment, verify_deployment | mock |
| hosting | fly-io | create_project, trigger_deployment, verify_deployment | mock |
| hosting | netlify | create_project, trigger_deployment, verify_deployment | mock |
| repository | github | create_repository, verify_repository | mock/live¹ |
| repository | local-git | create_repository, verify_repository | live (local) |
| repository | gitlab | create_repository, verify_repository | mock |
| dns | cloudflare | create_dns_record, verify_dns_record, issue_certificate², verify_certificate² | mock/live¹ |
| dns | route53 | create_dns_record, verify_dns_record, issue_certificate, verify_certificate | mock |
| email | resend | send_email (+ configure_email_domain, configure_catch_all in mock) | mock/live¹ |
| email | postmark | send_email, configure_email_domain, configure_catch_all | mock |
| sms | signalwire | send_sms | mock/live¹ |
| sms | twilio | send_sms | mock |
| voice | signalwire-voice | place_call, verify_call | mock |
| voice | telnyx | place_call, verify_call | mock |
| database | supabase | provision_database, verify_database | mock |
| database | neon | provision_database, verify_database | mock |
| payments | stripe | create_product, verify_product | mock/live¹ |
| payments | square | create_product, verify_product | mock |
| identity | google-identity | configure_oauth_client, verify_oauth_client | mock |
| storage | local-storage | store_artifact, verify_artifact | live (local) |
| storage | s3 | store_artifact, verify_artifact | mock |
| analytics | google-analytics | configure_analytics, verify_analytics | mock |
| analytics | google-tag-manager | configure_tag_container, verify_tag_container | mock |
| monitoring | uptime-monitor | configure_monitor, configure_alert, verify_monitor | mock |
| browser_automation | playwright | run_browser_task, verify_browser_task | mock |
| llm | anthropic | generate_completion | mock |
| search_console | google-search-console | submit_sitemap, verify_site_ownership | mock |
| search_console | bing-webmaster | submit_sitemap, verify_site_ownership | mock |
| business_listing | google-business-profile | create_listing, verify_listing | mock |
| maps | google-maps | configure_maps_key, verify_maps_key | mock |
| calendar | google-calendar | create_calendar, create_event, verify_calendar | mock |
| crm | hubspot | create_crm_contact, verify_crm_contact | mock |
| forms | typeform | create_form, verify_form | mock |

¹ live when the provider's `requiredCredentials` env vars are configured; mock otherwise. Mocks fail closed in production.
² certificate actions available on the mock adapter; the live Cloudflare adapter currently declares DNS record actions only.

Capability routing is validated fail-closed: a plan step requesting an action a
provider does not declare is rejected (`validateDraftPlan`).
