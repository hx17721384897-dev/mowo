import { uploadRegisteredPrivateFile } from '@/services/private-upload'

export type CustomizationUploadPurpose =
  'CUSTOMIZATION_SOURCE' | 'CUSTOMIZATION_FRAME' | 'LIBRARY_FRAME'

export async function uploadCustomizationFiles(
  files: readonly File[],
  purpose: CustomizationUploadPurpose,
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const objectKeys: string[] = []
  for (const file of files) {
    objectKeys.push(await uploadRegisteredPrivateFile(file, purpose))
    onProgress?.(objectKeys.length, files.length)
  }
  return objectKeys
}
