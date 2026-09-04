"use client"

import {
  Children,
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

interface FileUploadContextValue {
  isDragging: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  multiple: boolean
  disabled: boolean
}

const FileUploadContext = createContext<FileUploadContextValue | null>(null)

interface FileUploadProps {
  onFilesAdded: (files: File[]) => void
  children: React.ReactNode
  multiple?: boolean
  accept?: string
  disabled?: boolean
}

function FileUpload({
  onFilesAdded,
  children,
  multiple = true,
  accept,
  disabled = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const addFiles = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList)
      onFilesAdded(multiple ? files : files.slice(0, 1))
    },
    [multiple, onFilesAdded]
  )

  useEffect(() => {
    function preventDefault(event: DragEvent) {
      event.preventDefault()
      event.stopPropagation()
    }

    function handleDragEnter(event: DragEvent) {
      preventDefault(event)
      dragCounter.current += 1
      if (event.dataTransfer?.items.length) setIsDragging(true)
    }

    function handleDragLeave(event: DragEvent) {
      preventDefault(event)
      dragCounter.current -= 1
      if (dragCounter.current === 0) setIsDragging(false)
    }

    function handleDrop(event: DragEvent) {
      preventDefault(event)
      dragCounter.current = 0
      setIsDragging(false)
      if (!disabled && event.dataTransfer?.files.length) {
        addFiles(event.dataTransfer.files)
      }
    }

    window.addEventListener("dragenter", handleDragEnter)
    window.addEventListener("dragleave", handleDragLeave)
    window.addEventListener("dragover", preventDefault)
    window.addEventListener("drop", handleDrop)

    return () => {
      window.removeEventListener("dragenter", handleDragEnter)
      window.removeEventListener("dragleave", handleDragLeave)
      window.removeEventListener("dragover", preventDefault)
      window.removeEventListener("drop", handleDrop)
    }
  }, [addFiles, disabled])

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) addFiles(event.target.files)
    event.target.value = ""
  }

  return (
    <FileUploadContext.Provider
      value={{ isDragging, inputRef, multiple, disabled }}
    >
      <input
        accept={accept}
        aria-hidden="true"
        className="hidden"
        disabled={disabled}
        multiple={multiple}
        onChange={handleFileSelect}
        ref={inputRef}
        type="file"
      />
      {children}
    </FileUploadContext.Provider>
  )
}

type FileUploadTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  asChild?: boolean
}

function FileUploadTrigger({
  asChild = false,
  className,
  children,
  ...props
}: FileUploadTriggerProps) {
  const context = useContext(FileUploadContext)

  function openFilePicker() {
    if (!context?.disabled) context?.inputRef.current?.click()
  }

  if (asChild) {
    const child = Children.only(children) as React.ReactElement<
      React.HTMLAttributes<HTMLElement>
    >

    return cloneElement(child, {
      ...props,
      role: "button",
      className: cn(className, child.props.className),
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        event.stopPropagation()
        openFilePicker()
        child.props.onClick?.(event)
      },
    })
  }

  return (
    <button
      className={className}
      onClick={openFilePicker}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}

function FileUploadContent(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...contentProps } = props
  const context = useContext(FileUploadContext)

  if (
    !context?.isDragging ||
    context.disabled ||
    typeof document === "undefined"
  ) {
    return null
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm",
        "animate-in duration-150 fade-in-0 zoom-in-95",
        className
      )}
      {...contentProps}
    />,
    document.body
  )
}

export { FileUpload, FileUploadContent, FileUploadTrigger }
