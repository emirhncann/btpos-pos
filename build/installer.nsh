!include LogicLib.nsh
!include FileFunc.nsh

!define MUI_DIRECTORYPAGE_TEXT_TOP "Otomatik güncellemenin sorunsuz çalışması için C:\BTPOS veya D:\BTPOS gibi bir klasör önerilir."

; İlk açılışta önerilen yer. Kayıtlı kurulum yolu bundan sonra initMultiUser ile gelir.
!macro preInit
  IfFileExists "D:\*.*" 0 btpos_pre_c
    StrCpy $INSTDIR "D:\BTPOS\program"
    Goto btpos_pre_end
  btpos_pre_c:
    StrCpy $INSTDIR "C:\BTPOS\program"
  btpos_pre_end:
!macroend

; Tüm kullanıcılar sorusunu geç; kullanıcı klasörüne kur. Yönetici sadece korumalı dizin seçilirse çıkar.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; preInit, kayıtlı yol yokken LocalAppData varsayılanı tarafından ezilir. Burada tekrar yaz.
!macro customInit
  ${If} $perUserInstallationFolder == ""
    IfFileExists "D:\*.*" 0 btpos_init_c
      StrCpy $INSTDIR "D:\BTPOS\program"
      Goto btpos_init_end
    btpos_init_c:
      StrCpy $INSTDIR "C:\BTPOS\program"
    btpos_init_end:
  ${EndIf}
!macroend

; Dizin sayfasından sonra, dosya kopyalanmadan önce INSTDIR ...\program olsun.
; Kayıtlı güncelleme yolu zaten ...\program ise olduğu gibi kalır.
!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Page custom btposFixDirPre
  !macroend

  Function btposFixDirPre
    Call btposEnsureProgramDir
    Abort
  FunctionEnd

  Function btposEnsureProgramDir
    StrCpy $R8 "$INSTDIR" 1 -1
    ${If} $R8 == "\"
      StrCpy $INSTDIR "$INSTDIR" -1
    ${EndIf}

    StrCpy $R8 "$INSTDIR" 8 -8
    ${If} $R8 == "\program"
      Return
    ${EndIf}

    StrLen $R6 "$INSTDIR"
    IntOp $R5 $R6 - 5
    StrCpy $R4 0
    StrCpy $R9 0
    btpos_scan:
      IntCmp $R4 $R5 btpos_scan_end btpos_scan_end
      StrCpy $R3 "$INSTDIR" 5 $R4
      StrCmp $R3 "BTPOS" btpos_found
      IntOp $R4 $R4 + 1
      Goto btpos_scan
    btpos_found:
      StrCpy $R9 1
    btpos_scan_end:
    ${If} $R9 == 0
      StrCpy $INSTDIR "$INSTDIR\BTPOS"
    ${EndIf}
    StrCpy $INSTDIR "$INSTDIR\program"
  FunctionEnd
!endif

!macro customInstall
  ${GetParent} "$INSTDIR" $R7
  CreateDirectory "$R7\db"
  CreateDirectory "$R7\db\backups"
  CreateDirectory "$R7\log"
!macroend
