"use client";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Button, Field, Notice } from "@/components/ui/primitives";

export {NotificationSettings} from './notification-settings';
import {DuplicateContacts,PrivacySettings} from './data-lifecycle';
import {WebhookSettings} from './webhooks';
import {McpSettings} from './mcp-settings';

export function ReferenceSettings({section}:{section:string}) {
  if(section==='dados') return <DuplicateContacts/>;
  if(section==='privacy') return <PrivacySettings/>;
  if(section==='mcp') return <McpSettings/>;
  return <WebhookSettings/>;
}
