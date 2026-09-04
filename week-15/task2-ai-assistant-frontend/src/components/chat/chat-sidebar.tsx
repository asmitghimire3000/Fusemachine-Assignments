"use client"

import { useState } from "react"
import { Check, Edit3, LogOut, MessageSquarePlus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { ChatSession } from "@/features/chat/types"
import type { AuthenticatedUser } from "@/features/auth/types"
import { Button } from "../ui/button"
import { Input } from "../ui/input"

interface ChatSidebarProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => Promise<void>
  onLogout: () => Promise<void>
  user: AuthenticatedUser
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onLogout,
  user,
}: ChatSidebarProps) {
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [isSavingTitle, setIsSavingTitle] = useState(false)

  function startEditing(session: ChatSession) {
    setEditingSessionId(session.id)
    setEditingTitle(session.title)
  }

  function cancelEditing() {
    if (isSavingTitle) return
    setEditingSessionId(null)
    setEditingTitle("")
  }

  async function saveTitle() {
    if (!editingSessionId || isSavingTitle) return

    const title = editingTitle.trim()
    if (!title) return

    setIsSavingTitle(true)
    try {
      await onRenameSession(editingSessionId, title)
      toast.success("Chat title updated")
      setEditingSessionId(null)
      setEditingTitle("")
    } catch {
      setIsSavingTitle(false)
      return
    }
    setIsSavingTitle(false)
  }

  function confirmDelete() {
    if (!sessionToDelete) return

    onDeleteSession(sessionToDelete.id)
    setSessionToDelete(null)
  }

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onCreateSession} size="lg">
                <MessageSquarePlus aria-hidden="true" />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sessions.map((session) => (
                  <SidebarMenuItem key={session.id}>
                    {editingSessionId === session.id ? (
                      <div className="flex items-center gap-1 px-1 py-1">
                        <Input
                          aria-label={`Edit ${session.title}`}
                          autoFocus
                          className="h-8 rounded-md px-2 text-sm"
                          disabled={isSavingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveTitle()
                            if (event.key === "Escape") cancelEditing()
                          }}
                          value={editingTitle}
                        />
                        <Button
                          aria-label="Save chat title"
                          className="size-7 shrink-0"
                          disabled={isSavingTitle || !editingTitle.trim()}
                          onClick={() => void saveTitle()}
                          size="icon"
                          title="Save chat title"
                          type="button"
                          variant="ghost"
                        >
                          <Check aria-hidden="true" className="size-4" />
                        </Button>
                        <Button
                          aria-label="Cancel editing chat title"
                          className="size-7 shrink-0"
                          disabled={isSavingTitle}
                          onClick={cancelEditing}
                          size="icon"
                          title="Cancel"
                          type="button"
                          variant="ghost"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <SidebarMenuButton
                        isActive={session.id === activeSessionId}
                        onClick={() => onSelectSession(session.id)}
                      >
                        <span>{session.title}</span>
                      </SidebarMenuButton>
                    )}
                    {editingSessionId !== session.id ? (
                      <SidebarMenuAction
                        aria-label={`Edit ${session.title}`}
                        className="right-7"
                        onClick={() => startEditing(session)}
                        showOnHover
                        title="Edit chat title"
                      >
                        <Edit3 aria-hidden="true" />
                      </SidebarMenuAction>
                    ) : null}
                    {editingSessionId !== session.id ? (
                      <SidebarMenuAction
                        aria-label={`Delete ${session.title}`}
                        onClick={() => setSessionToDelete(session)}
                        showOnHover
                        title="Delete chat"
                      >
                        <Trash2 aria-hidden="true" />
                      </SidebarMenuAction>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex w-full items-center gap-2 px-2 py-2">
                <Avatar size="sm">
                  {user.avatar_url ? (
                    <AvatarImage alt="" src={user.avatar_url} />
                  ) : null}

                  <AvatarFallback>
                    {user.display_name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <span className="min-w-0 flex-1 truncate">
                  {user.display_name}
                </span>

                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  onClick={() => setLogoutDialogOpen(true)}
                  aria-label="Sign out"
                  title="Sign out"
                  className="shrink-0"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar >

      <AlertDialog
        open={sessionToDelete !== null}
        onOpenChange={(open) => !open && setSessionToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              {sessionToDelete?.title} and its messages will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out of your account?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>

            <AlertDialogAction
              onClick={() => void onLogout()}
              variant="destructive"
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
